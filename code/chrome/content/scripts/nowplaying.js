// This script gets loaded into the display pane so there are no namespace
// issues here

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;


Cu.import("resource://app/jsmodules/kPlaylistCommands.jsm");

var nowPlayingListener = {
  onQueueStart : function(aQueue) {
    bind(aQueue);
  },

  onQueueEnd : function(aQueue) { }
};

function bind(queue) {
    var playlist = document.getElementById("playlist");
    var commandsMgr = Cc["@songbirdnest.com/Songbird/PlaylistCommandsManager;1"]
                      .createInstance(Ci.sbIPlaylistCommandsManager);
    var commands = commandsMgr.request(kPlaylistCommands.MEDIAITEM_DEFAULT);
    playlist.bindQueue(queue, commands);
}

function onLoad(event) {
  var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
            .getService(Ci.sbINowPlayingService);
  nps.QueryInterface(Ci.sbINowPlayingEventTarget);
  nps.addListener(nowPlayingListener);

   var prefs = Cc["@mozilla.org/preferences-service;1"]
              .getService(Ci.nsIPrefBranch);

   var fadespeed = prefs.getIntPref("extensions.nowplaying@j.c.m.fadespeed");

   document.getElementById("fadetonext-scale").value = fadespeed;

  if (nps.currentQueue) {
    bind(nps.currentQueue);
  }
}

function onUnload(event) {
  var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
            .getService(Ci.sbINowPlayingService);
  nps.QueryInterface(Ci.sbINowPlayingEventTarget);
  nps.removeListener(nowPlayingListener);
}

// Clears the current queue
function clearList() {
  var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
            .getService(Ci.sbINowPlayingService);
  if (nps.currentQueue)
    nps.currentQueue.clear();
}

// Creates a new media list from the current queue and brings up an edit box in
// the service pane
function saveList() {
  var nps = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
            .getService(Ci.sbINowPlayingService);
  if (nps.currentQueue) {

    // Default name of the new playlist
    var stringBundleService = Cc["@mozilla.org/intl/stringbundle;1"]
                              .getService(Ci.nsIStringBundleService);
    var sbBundle = stringBundleService.createBundle("chrome://songbird/locale/songbird.properties");
    var defaultName = sbBundle.GetStringFromName("playlist");
    var list = nps.currentQueue.getMediaList(defaultName);

    lsps  = Cc["@songbirdnest.com/servicepane/library;1"]
		        .getService(Ci.sbILibraryServicePaneService);
    var node = lsps.getNodeForLibraryResource(list);

    var wMediator = Cc["@mozilla.org/appshell/window-mediator;1"]
                    .getService(Ci.nsIWindowMediator);
    var mainWindow = wMediator.getMostRecentWindow("Songbird:Main");

    mainWindow.gServicePane.startEditingNode(node);
  }
}


// Reduce volume to zero according to slider value
// move to next song, restore volume.
function fadetonext() {
    var gMM = Cc["@songbirdnest.com/Songbird/Mediacore/Manager;1"]
                .getService(Ci.sbIMediacoreManager);

    set_fade_pref();

    //alert("fadetonext");
    var vController = gMM.volumeControl;
    var volume = vController.volume;
    var original_volume = volume;
    var increment = document.getElementById("fadetonext-scale").value;
    increment = increment / 1000000;

    //alert("increment: " + increment);
    //alert("increment: " + isNaN(increment));
    //alert("volume: " + volume);
    //alert("volume: " + isNaN(volume));
    //alert("volume-: " + volume-increment);

    var i=0;
    while (volume > 0){
        i++;
        volume = volume - increment;
        vController.volume = volume;
        //for (var j=0; j<100; j++){}
        //if (i%1000 == 0)
         //   alert("volume is: " + volume);
    }

    //alert("i is: " + i + "volume is: " + volume);

    gMM.sequencer.next();
    vController.volume = original_volume;
}

function set_fade_pref() {

  var prefs = Cc["@mozilla.org/preferences-service;1"]
              .getService(Ci.nsIPrefBranch);

  var fadespeed = document.getElementById("fadetonext-scale").value;

  prefs.setIntPref("extensions.nowplaying@j.c.m.fadespeed", fadespeed);
}

window.addEventListener("load", function(e) { onLoad(e); }, false);
window.addEventListener("unload", function(e) { onUnload(e); }, false);
