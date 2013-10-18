/* Shortcuts */
const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;

/* Module imports */
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://app/jsmodules/sbLibraryUtils.jsm");
Cu.import("resource://app/jsmodules/sbProperties.jsm");
Cu.import("resource://app/jsmodules/DropHelper.jsm");

/* Extension information */
const EXTENSION_UUID = "nowplaying@j.c.m";

/* Component information */
const CONTRACTID = "@songbirdnest.com/Songbird/now-playing/service;1";
const CLASSNAME  = "Now Playing Service";
const CID        = Components.ID("{a26189cb-f031-4bad-af99-0cd18cc9ce38}");

/* Stringbundles */
const SONGBIRD_STRINGBUNDLE   = "chrome://songbird/locale/songbird.properties";
const NOWPLAYING_STRINGBUNDLE = "chrome://nowplaying/locale/nowplaying.properties";

/* Preferences */
const PREF_LIST_GUID           = "extensions.nowplaying@j.c.m.listguid";

/* Services */
var gOS    = null;
var gPrefs = null;
var gNPS   = null;




/*
 * -----------------------------------------------------------------------------
 * Now Playing Service Component
 * -----------------------------------------------------------------------------
 */

function sbNowPlayingService() {
  gNPS = this;

  // Get mozilla services
  gOS    = Cc["@mozilla.org/observer-service;1"]
           .getService(Ci.nsIObserverService);
  gPrefs = Cc["@mozilla.org/preferences-service;1"]
           .getService(Ci.nsIPrefBranch);

  if (gOS.addObserver) {
    gOS.addObserver(this, "songbird-library-manager-ready", false);
    gOS.addObserver(this, "songbird-library-manager-before-shutdown", false);
    gOS.addObserver(this, "xul-window-visible", false);

    gOS.addObserver(this, "em-action-requested", false);
    gOS.addObserver(this, "quit-application-granted", false);
  }

  // Alter the ExternalDropHandler
  ExternalDropHandler.dropOnList = function(aWindow, 
                                            aDragSession, 
                                            aTargetList, 
                                            aDropPosition, 
                                            aListener) {
    if (!aTargetList) {
      throw new Error("No target medialist specified for dropOnList");
    }

    if (gNPS.currentQueue &&
        gNPS.currentQueue.view.mediaList.equals(aTargetList)) {
      gNPS.currentQueue.dropSomeExternal(aWindow,
                                         aDragSession,
                                         aDropPosition);
      return;
    }

    this._dropFiles(aWindow,
                    aDragSession, 
                    null,
                    aTargetList, 
                    aDropPosition, 
                    aListener);
  }
}
sbNowPlayingService.prototype.constructor = sbNowPlayingService;
sbNowPlayingService.prototype = {

  /* XPCOM registration */

  classDescription : CLASSNAME,
  classID          : CID,
  contractID       : CONTRACTID,

  _xpcom_factory  :
  {
    singleton: null,
    createInstance: function (aOuter, aIID)
    {
      if (aOuter != null)
        throw Components.results.NS_ERROR_NO_AGGREGATION;
      if (this.singleton == null)
        this.singleton = new sbNowPlayingService();
      return this.singleton.QueryInterface(aIID);
    }
  },

  _xpcom_categories : [{
    category : "app-startup",
    service  : true
  }],

  QueryInterface:
    XPCOMUtils.generateQI([Ci.sbINowPlayingService,
                           Ci.sbINowPlayingEventTarget,
                           Ci.nsIObserver]),


  /* private members */

  _list                     : null,

  _currentQueue             : null,

  _listeners                : [],

  _initialized              : false,
  _shouldUninstall          : false,


  /* private methods */

  _initialize : function() {
    if (this._initialized)
      return;


    // Get the media list by looking up its guid, if it does not exist then
    // create a new one
    var guid = gPrefs.getCharPref(PREF_LIST_GUID);
    var library = LibraryUtils.mainLibrary;
    try {
      var item = library.getMediaItem(guid);
      var list = item.QueryInterface(Ci.sbIMediaList);
      this._list = list;
    } catch (e) {
      // The list doesn't exist, create a new one

      var listProperties =
        Cc["@songbirdnest.com/Songbird/Properties/MutablePropertyArray;1"]
        .createInstance(Components.interfaces.sbIPropertyArray);
      listProperties.appendProperty(SBProperties.hidden, "1");

      var list = library.createMediaList("simple", listProperties);
      list.name = getString("playlistname", "Now playing");

      // save the guid of the media list so it can be looked up next time
      gPrefs.setCharPref(PREF_LIST_GUID, list.guid);

      // set up default column specifications
      var columnSpec = SBProperties.trackName + " 170 " +
                       SBProperties.rating + " 80";
      list.setProperty(SBProperties.columnSpec, columnSpec);
      list.setProperty(SBProperties.defaultColumnSpec, columnSpec);

      this._list = list;
    }
    this._list.clear();

    this._initialized = true;
  },


  _finalize : function() {
    this._list = null;
    this._currentQueue = null;    

    // Remove any remaining listeners
    this._listeners = null;
  },


  _performUninstall : function() {
    // Delete the medialist
    var library = LibraryUtils.mainLibrary;
    library.remove(this._list);

    // Clear preferences
    gPrefs.clearUserPref(PREF_LIST_GUID);
  },



  
  /* sbINowPlayingService */
  get privateList() {
    return this._list;
  },

  /* sbINowPlayingService */
  get currentQueue() {
    return this._currentQueue;
  },

  /* sbINowPlayingService */
  startQueue : function(aView, aIndex) {
    if (this._currentQueue) {
      this._currentQueue.destroy();
    }

    // Flush out the old list
    this._list.clear();

    if (aView) {
      // Copy the contents of this view into the private list. This has to be done
      // So the user is able to modify the list without affecting the original
      // list

      var currentIndex = aView.selection.currentIndex;
      aView.selection.selectAll();
      var items = aView.selection.selectedMediaItems;

      this._list.addSome(items);
      aView.selection.selectNone();
      if (currentIndex > 0) {
        aView.selection.select(currentIndex);
      }
    }
    var view = this._list.createView();

    if (!aIndex) {
      aIndex = Ci.sbIMediacoreSequencer.AUTO_PICK_INDEX;
    }

    this._currentQueue = Cc["@songbirdnest.com/Songbird/now-playing/queue;1"]
                         .createInstance(Ci.sbINowPlayingQueue);
    this._currentQueue.init(view, aIndex);

    return this._currentQueue;
  },

  /* sbINowPlayingEventTarget */
  addListener : function(aListener) {
    if (this._listeners.indexOf(aListener) == -1) {
      this._listeners.push(aListener);
    }
  },

  /* sbINowPlayingEventTarget */
  removeListener : function(aListener) {
    var index = this._listeners.indexOf(aListener);
    if (index > -1) {
      this._listeners.splice(index, 1);
    }
  },

  /* sbINowPlayingEventTarget */
  dispatchEvent : function(aEvent) {
    for (var i in this._listeners) {
     var listener = this._listeners[i];
      if (!(listener instanceof Ci.sbINowPlayingEventListener)) continue;
      
      switch (aEvent.type) {
        case Ci.sbINowPlayingEvent.QUEUE_START :
          listener.onQueueStart(aEvent.data);
          break;
        case Ci.sbINowPlayingEvent.QUEUE_END :
          listener.onQueueEnd(aEvent.data);
          break;
      }
    }
  },


  // watch for XRE startup and shutdown messages
  observe: function(subject, topic, data) {
    switch (topic) {
    case "songbird-library-manager-ready" :
      gOS.removeObserver(this, "songbird-library-manager-ready");

      this._initialize();
      break;

    // Must shut down the service before the library goes away
    case "songbird-library-manager-before-shutdown" :
      gOS.removeObserver(this, "songbird-library-manager-before-shutdown");

      this._finalize();

      // Release services to avoid memory leaks
      gOS    = null;
      gPrefs = null;
      break;

    case "em-action-requested" :
      subject.QueryInterface(Components.interfaces.nsIUpdateItem);
      if (subject.id == EXTENSION_UUID) {
        switch (data) {
        case "item-uninstalled" :
        case "item-disabled" :
          this._shouldUninstall = true;
          break;
        case "item-cancel-action" :
          this._shouldUninstall = false;
          break;
        }
      }
      break;

    case "quit-application-granted" :
      gOS.removeObserver(this,"em-action-requested");
      gOS.removeObserver(this,"quit-application-granted");
      if (this._shouldUninstall) {
        this._performUninstall();
      }
      break;

    }
  }
};



// XPCOM Registration
function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([sbNowPlayingService]);
}

// helper function
function getString(aName, aDefaultValue) {
  var stringBundleService = Cc["@mozilla.org/intl/stringbundle;1"]
                            .getService(Ci.nsIStringBundleService);

  var sbBundle = stringBundleService.createBundle(SONGBIRD_STRINGBUNDLE);
  try {
    return sbBundle.GetStringFromName(aName);
  } catch (e) {
    // do nothing, try extension string bundle
  }

  var npBundle = stringBundleService.createBundle(NOWPLAYING_STRINGBUNDLE);
  try {
    return npBundle.GetStringFromName(aName);
  } catch(e) {
    return aDefaultValue;
  }
}
