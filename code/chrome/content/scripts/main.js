
// Shorthand
if (typeof(Cc) == "undefined")
  var Cc = Components.classes;
if (typeof(Ci) == "undefined")
  var Ci = Components.interfaces;
if (typeof(Cu) == "undefined")
  var Cu = Components.utils;
if (typeof(Cr) == "undefined")
  var Cr = Components.results;
if (typeof(CC) == "undefined")
  var CC = Components.Constructor;

// Make a namespace.
if (typeof NowPlayingList == 'undefined') {
  var NowPlayingList = {};
}

//IsControlPressed
var CtrlPressed = false;
document.onkeydown=function(e)
{
	//alert('Woo Hoo, I made a menuitem!');

    // Detect which key was pressed
    if( e.which == 17 )
        CtrlPressed = true;
    // Repeat for each key you care about...
}
document.onkeyup=function(e)
{

    // Detect which key was released
    if( e.which == 17 )
        CtrlPressed = false;
}



NowPlayingList.privateListListener = {
  init : function() {
    var createDataRemote = new CC("@songbirdnest.com/Songbird/DataRemote;1",
                                  Ci.sbIDataRemote,
                                  "init");
    this.lengthRemote = createDataRemote("jcm.nowplaying.length", null);

    this.batchCount = 0;
  },

  destroy : function() {
    this.lengthRemote.unbind();
  },



  onItemAdded : function(list, item, index) {
    if (this.batchCount > 0)
      return true;
    this.updateLength(list.length);
  },

  onBeforeItemRemoved : function(list, item, index) {
    return true;
  },

  onAfterItemRemoved : function(list, item, index) {
    if (this.batchCount > 0)
      return true;
    this.updateLength(list.length);
  },

  onItemUpdated : function(list, item, props) {
    return true;
  },

  onItemMoved : function(list, from, to) {
    return true;
  },

  onListCleared : function(list) {
    if (this.batchCount > 0)
      return true;
    this.updateLength(list.length);
  },

  onBatchBegin : function(list) {
    this.batchCount++;
  },

  onBatchEnd : function(list) {
    this.batchCount--;
    if (this.batchCount == 0) {
      var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
                .getService(Ci.sbINowPlayingService);
      this.updateLength(nps.privateList.length);
    }
  },



  updateLength : function(len) {
    switch (len) {
      case 0 :
        this.lengthRemote.stringValue = getString("library.noitem", "no items");
        break;
      case 1 :
        this.lengthRemote.stringValue = "1 " + getString("library.oneitem", "item");
        break;
      case "" :
        this.lengthRemote.stringValue = "";
        break;
      default :
        this.lengthRemote.stringValue = len + " " + getString("library.manyitems", "items");
        break;
    }
  }
}

// Called when the window finishes loading
NowPlayingList.onLoad = function(event) {
  window.removeEventListener("load", function(e) { NowPlayingList.onLoad(e); }, false);

  // Don't do this twice
  if (this._loaded) return;
  this._loaded = true;
  
  var mm = Cc["@songbirdnest.com/Songbird/Mediacore/Manager;1"]
            .getService(Ci.sbIMediacoreManager);
  var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
            .getService(Ci.sbINowPlayingService);

  // Don't mess with already existing queues, this can happen when the feather
  // changes
  if (nps.currentQueue)
    return;

  if (mm.status.state == Ci.sbIMediacoreStatus.STATUS_PLAYING ||
      mm.status.state == Ci.sbIMediacoreStatus.STATUS_PAUSED ||
      mm.status.state == Ci.sbIMediacoreStatus.STATUS_BUFFERING) {
    // This usually means the user has Last Track Resume installed
    // If the track is already a few seconds in, this will start playing it again
    nps.startQueue(mm.sequencer.view, mm.sequencer.viewPosition);
  }
  else {
    nps.startQueue();
  }

  NowPlayingList.privateListListener.init();
  NowPlayingList.privateListListener.updateLength(nps.privateList.length);


  var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
            .getService(Ci.sbINowPlayingService);
  nps.QueryInterface(Ci.sbINowPlayingEventTarget);
  nps.privateList.addListener(NowPlayingList.privateListListener);

  // Check whether this is the first run to open up about page
  var prefs = Cc["@mozilla.org/preferences-service;1"]
              .getService(Ci.nsIPrefBranch);
  var firstrun = prefs.getBoolPref("extensions.nowplaying@j.c.m.firstrun.1.2.0");
  if (firstrun) {
    prefs.setBoolPref("extensions.nowplaying@j.c.m.firstrun.1.2.0", false);
    window.gBrowser.loadURI("about:nowplayinglist");
  }
  
  // Attach a focus listener to the tabbrowser, this is used in conjunction with
  // a focus handler on the now playing list playlist, in order to track which
  // playlist the metadata editor should operate on
  window.gBrowser.addEventListener("focus", function(e) {window.gBrowser._mediaListViewForTrackEditor = null}, true);
}

// Called when the window is about to close
NowPlayingList.onUnload = function(event) {
  window.removeEventListener("unload", function(e) { NowPlayingList.onUnload(e); }, false);

  window.removeEventListener("Play", function(e) { NowPlayingList.onPlay(e); }, false);
  window.removeEventListener("ShowCurrentTrack", function(e) { NowPlayingList.onShowCurrentTrack(e); }, false);

  window.gBrowser.removeEventListener("focus", function(e) {window.gBrowser._mediaListViewForTrackEditor = null}, true);

  var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
            .getService(Ci.sbINowPlayingService);
  nps.QueryInterface(Ci.sbINowPlayingEventTarget);
  nps.privateList.removeListener(NowPlayingList.privateListListener);

  NowPlayingList.privateListListener.destroy();
}

NowPlayingList.onPlay = function(event) {
  try {
    var mm  = Cc["@songbirdnest.com/Songbird/Mediacore/Manager;1"]
              .getService(Ci.sbIMediacoreManager);
    var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
              .getService(Ci.sbINowPlayingService);

    // Try to find a view from the event. If one exists that's probably
    // what we should play from.
    var view = gSongbirdPlayerWindow._getMediaListViewForEvent(event);

    // First try and get the current queue's view
    if (!(view && view.length > 0)) {
      view = nps.currentQueue.view;
    }
    
    // If no view could be found, try getting one from the current tab
    if (!(view && view.length > 0)) {
      view = gBrowser.currentMediaListView;
    }
    
    // If the current tab has failed, try the media tab (if it exists)
    if (!(view && view.length > 0) && gBrowser.mediaTab) {
      view = gBrowser.mediaTab.mediaListView;
    }
    
    // If we've got a view, try playing it.
    if (view && view.length > 0) {

      // Do not handle web playlists
      var contentURL = view.getItemByIndex(0)
                           .getProperty("http://songbirdnest.com/data/1.0#contentURL");
      if (contentURL.indexOf("http://") == 0 ||
          contentURL.indexOf("https://") == 0) {
        return;
      }
      
      var index = view.selection.currentIndex;
      
      // If same view as current view on sequencer and nothing
      // selected in the view, use sequencer view position.
      if((index == -1) && (mm.sequencer.view == view)) {
        try {
          index = mm.sequencer.viewPosition;
        }
        catch (e) { }
      }

      // Fallback
      if (index == -1) {
        switch (mm.sequencer.mode) {
          case Ci.sbIMediacoreSequencer.MODE_SHUFFLE :
            index = Math.floor(Math.random()*view.length);
            break;
          case Ci.sbIMediacoreSequencer.MODE_FORWARD :
          case Ci.sbIMediacoreSequencer.MODE_CUSTOM :
            index = 0;
            break;
        }
      }
      
      NowPlayingList.handleTrack(view, index);
      
      // Since we've handled this play event, prevent any fallback action from
      // occurring.
      event.preventDefault();
      event.stopPropagation();
    } 
  } catch (e) {
    Cu.reportError(e);
  }
}

NowPlayingList.handleTrack = function(view, index) {
  var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
            .getService(Ci.sbINowPlayingService);
  var mm = Cc["@songbirdnest.com/Songbird/Mediacore/Manager;1"]
           .getService(Ci.sbIMediacoreManager);
      
  if (view.mediaList.equals(nps.currentQueue.view.mediaList)) {
    mm.sequencer.playView(view, index);
    return;
  }

  var prefs = Cc["@mozilla.org/preferences-service;1"]
              .getService(Ci.nsIPrefBranch);
              
  //use a different action if control is pressed
  if(!CtrlPressed){
    var playwhen = prefs.getIntPref("extensions.nowplaying@j.c.m.playwhen");
    var putwhere = prefs.getIntPref("extensions.nowplaying@j.c.m.putwhere");
  }
  else{
    var playwhen = prefs.getIntPref("extensions.nowplaying@j.c.m.ctrlplaywhen");
    var putwhere = prefs.getIntPref("extensions.nowplaying@j.c.m.ctrlputwhere");
  }

  // defaults
  switch (playwhen) {
    case 0 :
    case 1 :
    case 2 :
      break;
    default :
      playwhen = 1;
  }
  switch (putwhere) {
    case 0 :
    case 1 :
      break;
    default :
      putwhere = 1;
  }
  
  var item = view.getItemByIndex(index);

  // Try and get the sequence position
  var sequencePosition;
  try {
    if (mm.status.state == Ci.sbIMediacoreStatus.STATUS_PLAYING ||
        mm.status.state == Ci.sbIMediacoreStatus.STATUS_PAUSED ||
        mm.status.state == Ci.sbIMediacoreStatus.STATUS_BUFFERING) {
      sequencePosition = mm.sequencer.sequencePosition;
    }
    else {
      // The mediacore will still report the sequence position being 0 even if
      // nothing is actually playing
      sequencePosition = -1;
    }
  }
  catch (e) {
    // Not available
    sequencePosition = -1;
  }

  // Play the selected track now
  if (playwhen == 0) {

    // Insert the track at the top
    if (putwhere == 0) {
      if (nps.currentQueue.view.length > 0) {
        if (sequencePosition > -1) {
          nps.currentQueue.insertAt(item, sequencePosition);
          mm.sequencer.playView(nps.currentQueue.view, nps.currentQueue.wrappedJSObject.forwardSequenceJS[sequencePosition]);
        }
        else {
          nps.currentQueue.insertAt(item, 0);
          mm.sequencer.playView(nps.currentQueue.view, nps.currentQueue.wrappedJSObject.forwardSequenceJS[0]);
        }
      }
      else {
        nps.currentQueue.add(item);
        mm.sequencer.playView(nps.currentQueue.view, 0);
      }
    }

    // replace the whole list
    else if (putwhere == 1) {
      nps.startQueue(view,
                     Math.max(index, Ci.sbIMediacoreSequencer.AUTO_PICK_INDEX));
    }

  }

  // Play the selected track next
  else if (playwhen == 1) {
    if (nps.currentQueue.view.length > sequencePosition + 1) {
      nps.currentQueue.insertAt(item, sequencePosition + 1);
    }
    else {
      nps.currentQueue.add(item);
      if (nps.currentQueue.view.length == 1) {
        mm.sequencer.playView(nps.currentQueue.view, 0);
      }
    }
  }

  // Play the selected track last
  else if (playwhen == 2) {
    nps.currentQueue.add(item);
    if (nps.currentQueue.view.length == 1) {
      mm.sequencer.playView(nps.currentQueue.view, 0);
    }
  }
}


NowPlayingList.onShowCurrentTrack = function(event) {
  try {
    // First make sure the now playing list is actually showing
    var dpm = Cc["@songbirdnest.com/Songbird/DisplayPane/Manager;1"]
              .getService(Ci.sbIDisplayPaneManager);
    dpm.showPane("chrome://nowplaying/content/xul/nowplaying.xul");

    // delay a little bit to let the pane show up
    setTimeout(function() {
      var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
                .getService(Ci.sbINowPlayingService);
      nps.currentQueue.showCurrentTrack();
    }, 300);
    
      
    // prevent any fallback action from occurring.
    event.preventDefault();
  } catch (e) {
    Cu.reportError(e);
  }
}

window.addEventListener("load", function(e) { NowPlayingList.onLoad(e); }, false);
window.addEventListener("unload", function(e) { NowPlayingList.onUnload(e); }, false);

window.addEventListener("Play", function(e) { NowPlayingList.onPlay(e); }, true);
window.addEventListener("ShowCurrentTrack", function(e) { NowPlayingList.onShowCurrentTrack(e); }, false);

//window.addEventListener("onkeyup", function(e){ onKeyUp(e); }, false);
//window.addEventListener("onkeydown", function(e){ onKeyDown(e); }, false);

// This script gets loaded after the window has been loaded
NowPlayingList.onLoad();

function getString(aName, aDefaultValue) {
  var stringBundleService = Cc["@mozilla.org/intl/stringbundle;1"]
                            .getService(Ci.nsIStringBundleService);
  
  var sbBundle = stringBundleService.createBundle("chrome://songbird/locale/songbird.properties");
  try {
    return sbBundle.GetStringFromName(aName);
  } catch (e) {
    return aDefaultValue;
  }
}
