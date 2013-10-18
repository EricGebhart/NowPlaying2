Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://app/jsmodules/kPlaylistCommands.jsm");

const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;

/* Stringbundles */
const SONGBIRD_STRINGBUNDLE   = "chrome://songbird/locale/songbird.properties";
const NOWPLAYING_STRINGBUNDLE = "chrome://nowplaying/locale/nowplaying.properties";

var gOS    = null;
var gPrefs = null;

function NowPlayingCommands()
{
  gOS = Cc["@mozilla.org/observer-service;1"]
        .getService(Ci.nsIObserverService);
  gPrefs = Cc["@mozilla.org/preferences-service;1"]
           .getService(Ci.nsIPrefBranch);
  
  if (gOS.addObserver) {
    gOS.addObserver(this, "playlist-commands-ready", false);
    gOS.addObserver(this, "playlist-commands-shutdown", false);
  }
}

NowPlayingCommands.prototype.constructor = NowPlayingCommands;

NowPlayingCommands.prototype = {
  classDescription: "Now Playing Commands",
  classID:          Components.ID("{216eae6f-2d48-46f6-9d6c-a17698bf7085}"),
  contractID:       "@j.c.m/NowPlaying/Commands;1", 

  _commands        : null,
  _mainLibraryGUID : null,
  
  _init: function() {
    
    const PlaylistCommandsBuilder = new Components.
      Constructor("@songbirdnest.com/Songbird/PlaylistCommandsBuilder;1", 
                  "sbIPlaylistCommandsBuilder");
                                  
    this._commands = new PlaylistCommandsBuilder();
    
    // Create the command
    this._commands.
           appendAction(null,
                        "nowplaying_enqueue_top",
                        getString("command.queuenext", "Queue Next"),
                        getString("command.tooltip.queuenext", "Play selected track(s) next"),
                        NowPlayingCmds_Enqueue_Top_OnTrigger);
    this._commands.
           appendAction(null,
                        "nowplaying_enqueue_bottom",
                        getString("command.queuelast", "Queue Last"),
                        getString("command.tooltip.queuelast", "Play selected track(s) last"),
                        NowPlayingCmds_Enqueue_Bottom_OnTrigger);
    this._commands.
           appendSeparator(null,
                           "nowplaying_enqueue_separator");
    this._commands.setCommandShortcut(null,
                                      "nowplaying_enqueue_bottom",
                                      getString("command.shortcut.key.queuelast", "Q"),
                                      getString("command.shortcut.keycode.queuelast", "VK_Q"),
                                      getString("command.shortcut.modifiers.queuelast", null),
                                      true);
                         
    
    
    this._mainLibraryGUID =
      gPrefs.getComplexValue("songbird.library.main",
                             Ci.nsISupportsString);
    
    var commandsManager = Cc["@songbirdnest.com/Songbird/PlaylistCommandsManager;1"]
                            .getService(Ci.sbIPlaylistCommandsManager);
    
    this._defaultCommands = commandsManager.request(kPlaylistCommands.MEDIAITEM_DEFAULT);
    
    commandsManager.registerPlaylistCommandsMediaItem(this._mainLibraryGUID, "", this._commands);
    commandsManager.registerPlaylistCommandsMediaItem(this._mainLibraryGUID, "", this._defaultCommands);
    
    commandsManager.registerPlaylistCommandsMediaItem("", "simple", this._commands);
    commandsManager.registerPlaylistCommandsMediaItem("", "simple", this._defaultCommands);
  },
  
  _shutdown: function() {

    var commandsManager = Cc["@songbirdnest.com/Songbird/PlaylistCommandsManager;1"]
                          .getService(Ci.sbIPlaylistCommandsManager);

    commandsManager.unregisterPlaylistCommandsMediaItem("", 
                                                        "simple", 
                                                        this._commands);
    this._commands.shutdown();
    this._commands = null;
  },
  
  // nsIObserver
  observe: function(aSubject, aTopic, aData) {
    switch (aTopic) {
      case "playlist-commands-ready":
        gOS.removeObserver(this, "playlist-commands-ready");
        if (aData == "default")
          this._init();
        break;
      case "playlist-commands-shutdown":
        gOS.removeObserver(this, "playlist-commands-shutdown");
        if (aData == "default")
          this._shutdown();
        
        gOS    = null;
        gPrefs = null;
        break;
    }
  },

  QueryInterface:
    XPCOMUtils.generateQI([Ci.nsIObserver]) 
};

function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([NowPlayingCommands],
  function(aCompMgr, aFileSpec, aLocation) {
    XPCOMUtils.categoryManager.addCategoryEntry(
      "app-startup",
      NowPlayingCommands.prototype.classDescription,
      "service," + NowPlayingCommands.prototype.contractID,
      true,
      true);
  });
}

// Called when Play Next is triggered
function NowPlayingCmds_Enqueue_Top_OnTrigger(aContext, aSubMenuId, aCommandId, aHost) {

  var mm  = Cc["@songbirdnest.com/Songbird/Mediacore/Manager;1"]
           .getService(Ci.sbIMediacoreManager);
  var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
           .getService(Ci.sbINowPlayingService);
  
  var view = unwrap(aContext.playlist).getListView();
  var sel = view.selection.selectedIndexedMediaItems;
  var count = view.selection.count;
  
  var unwrapper = {
    _enumerator : null,
    symbol : null,
    hasMoreElements : function() {
      return this._enumerator.hasMoreElements();
    },
    getNext : function() {
      var element = this._enumerator.getNext()[this.symbol];
      return element;
    },
    QueryInterface : function(iid) {
      if (iid.equals(Components.interfaces.nsISimpleEnumerator) ||
          iid.equals(Components.interfaces.nsISupports))
        return this;
      throw Components.results.NS_NOINTERFACE;
    }
  }
  unwrapper._enumerator = sel;

  if (view.mediaList.equals(nps.currentQueue.view.mediaList)) {
    unwrapper.symbol = "index";
    var array = [];
    while (unwrapper.hasMoreElements()) {
      array.push(unwrapper.getNext());
    }
    try {
      if (mm.sequencer.sequencePosition + 1 < nps.currentQueue.view.length) {
        nps.currentQueue.moveSomeTo(array, count, mm.sequencer.sequencePosition + 1)
      }
      else {
        // Sequence position is last, can't insert after the last position, have to append
        nps.currentQueue.moveSomeLast(array, count);
      }
    }
    catch (e) {
      // Sequence position is not available
      nps.currentQueue.moveSomeLast(array, count);
    }
  }
  else {
    unwrapper.symbol = "mediaItem";
    try {
      if (mm.sequencer.sequencePosition + 1 < nps.currentQueue.view.length) {
        nps.currentQueue.insertSomeAt(unwrapper, mm.sequencer.sequencePosition + 1)
      }
      else {
        // Sequence position is last, can't insert after the last position, have to append
        nps.currentQueue.addSome(unwrapper);
      }
    }
    catch (e) {
      // Sequence position is not available
      nps.currentQueue.addSome(unwrapper);
    }
  }
}

// Called when Add to queue is triggered
function NowPlayingCmds_Enqueue_Bottom_OnTrigger(aContext, aSubMenuId, aCommandId, aHost) {

  var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
           .getService(Ci.sbINowPlayingService);
  
  var view = unwrap(aContext.playlist).getListView();
  var sel = view.selection.selectedIndexedMediaItems;
  var count = view.selection.count;
  
  var unwrapper = {
    _enumerator : null,
    symbol : null,
    hasMoreElements : function() {
      return this._enumerator.hasMoreElements();
    },
    getNext : function() {
      var element = this._enumerator.getNext()[this.symbol];
      return element;
    },
    QueryInterface : function(iid) {
      if (iid.equals(Components.interfaces.nsISimpleEnumerator) ||
          iid.equals(Components.interfaces.nsISupports))
        return this;
      throw Components.results.NS_NOINTERFACE;
    }
  }
  unwrapper._enumerator = sel;

  if (view.mediaList.equals(nps.currentQueue.view.mediaList)) {
    unwrapper.symbol = "index";
    var array = [];
    while (unwrapper.hasMoreElements()) {
      array.push(unwrapper.getNext());
    }
    nps.currentQueue.moveSomeLast(array, count);
  }
  else {
    unwrapper.symbol = "mediaItem";
    nps.currentQueue.addSome(unwrapper);
  }
}



// helper functions

function unwrap(obj) {
  if (obj && obj.wrappedJSObject)
    obj = obj.wrappedJSObject;
  return obj;
}

function getString(aName, aDefaultValue) {
  var stringBundleService = Cc["@mozilla.org/intl/stringbundle;1"]
                            .getService(Ci.nsIStringBundleService);
  
  var sbBundle = stringBundleService.createBundle(SONGBIRD_STRINGBUNDLE);
  try {
    return sbBundle.GetStringFromName(aName);
  } catch (e) {
    // do nothing, try extension string bundle
  } 
  
  var jcmBundle = stringBundleService.createBundle(NOWPLAYING_STRINGBUNDLE);
  try {
    return jcmBundle.GetStringFromName(aName);
  } catch(e) {
    return aDefaultValue;
  }
}
