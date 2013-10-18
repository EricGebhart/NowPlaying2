Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const Cc = Components.classes;
const Ci = Components.interfaces;

function NowPlayingAboutHandler() { }

NowPlayingAboutHandler.prototype = {
    
    newChannel : function(aURI) {
        if(!aURI.spec == "about:mystuff") return;
        var ios = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
        var channel = ios.newChannel("chrome://nowplaying/content/xul/about.xul", null, null);
        channel.originalURI = aURI;
        return channel;
    },
    
    getURIFlags: function(aURI) {
        return Ci.nsIAboutModule.URI_SAFE_FOR_UNTRUSTED_CONTENT;
    },

    classDescription: "About Now Playing List Page",
    classID: Components.ID("63c9605a-f700-4314-b85e-ccff89e79c49"),
    contractID: "@mozilla.org/network/protocol/about;1?what=nowplayinglist",
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule])
}

function NSGetModule(aCompMgr, aFileSpec) {
  return XPCOMUtils.generateModule([NowPlayingAboutHandler]);
}

