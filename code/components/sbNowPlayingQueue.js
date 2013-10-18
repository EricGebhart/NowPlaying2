/* Shortcuts */
const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;
const CE = Components.Exception;
const Cr = Components.results;

/* Module imports */
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://app/jsmodules/ArrayConverter.jsm");
Cu.import("resource://app/jsmodules/sbProperties.jsm");
Cu.import("resource://app/jsmodules/sbLibraryUtils.jsm");
Cu.import("resource://app/jsmodules/DropHelper.jsm");

/* Extension information */
const EXTENSION_UUID = "nowplaying@j.c.m";

/* Component information */
const CONTRACTID = "@songbirdnest.com/Songbird/now-playing/queue;1";
const CLASSNAME  = "Now Playing Queue";
const CID        = Components.ID("{e10e1b25-5f84-4bc0-899a-3211c5bfa859}");

/* Stringbundles */
const SONGBIRD_STRINGBUNDLE   = "chrome://songbird/locale/songbird.properties";
const NOWPLAYING_STRINGBUNDLE = "chrome://nowplaying/locale/nowplaying.properties";


/* Services */
var gMM    = null;
var gNPS   = null;



function LOG(msg) {
  dump("sbNowPlayingQueue: " + msg + "\n");
}




/* 
 * -----------------------------------------------------------------------------
 * Now Playing Event Component 
 * -----------------------------------------------------------------------------
 */

function NowPlayingEvent(aType, aData) {
  this._type = aType;
  this._data = aData;
}
NowPlayingEvent.prototype = {
  get type() { return this._type },
  get data() { return this._data },
  QueryInterface: XPCOMUtils.generateQI([Ci.sbINowPlayingEvent])
};




/* 
 * -----------------------------------------------------------------------------
 * Now Playing Sequence Generator Component 
 * -----------------------------------------------------------------------------
 */

function NowPlayingSequenceGenerator(aSequence) {
  this._sequence = aSequence;
}
NowPlayingSequenceGenerator.prototype = {
  onGenerateSequence : function(aView, aSequenceLength) {
    aSequenceLength.value = this._sequence.length;
    return this._sequence;
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.sbIMediacoreSequenceGenerator])
};




/* 
 * -----------------------------------------------------------------------------
 * Now Playing Queue Component 
 * -----------------------------------------------------------------------------
 */

function sbNowPlayingQueue() {
  // Get the Now Playing Service
  gNPS   = Cc["@songbirdnest.com/Songbird/now-playing/service;1"]
           .getService(Ci.sbINowPlayingService);
  gMM    = Cc["@songbirdnest.com/Songbird/Mediacore/Manager;1"]
           .getService(Ci.sbIMediacoreManager);

  gMM.addListener(this);

  this._queuedViews = new Array();

  this.wrappedJSObject = this;
}
sbNowPlayingQueue.prototype.constructor = sbNowPlayingQueue;
sbNowPlayingQueue.prototype = {
  classDescription : CLASSNAME,
  classID          : CID,
  contractID       : CONTRACTID,
  
  QueryInterface:
    XPCOMUtils.generateQI([Ci.sbINowPlayingQueue,
                           Ci.sbIMediacoreEventListener,
                           Ci.sbIMediaListViewListener,
                           Ci.nsITimerCallback]),
  

  /* private members */

  _initialized               : false,

  _customized                : false,

  // The private media list used by this queue when it is customised. This is
  // just a reference to the service internal list
  _privateList               : null,

  _view                      : null,
  _sequence                  : null,

  // A cache for the sequence reported by the mediacore as a JS array
  _mediacoreSequence         : null,

  _ignoreSequenceChangeEvents: false,

  // The bound views
  _queuedViews               : null,



  get mediacoreSequence() {
    if (!this._mediacoreSequence) {
      this._mediacoreSequence = getMediacoreSequence();
    }
    return this._mediacoreSequence;
  },


  /* sbINowPlayingQueue */
  init : function(aView, aIndex) {
    if (this._initialized) {
      throw new CE("Queue already initialized!",
                   Cr.NS_ERROR_ALREADY_INITIALIZED);
    }
    
    this._view = aView;
    this._privateList = aView.mediaList;

    // This is a fresh queue, so it is impossible for the sequence to be
    // customised yet
    if (gMM.sequencer.mode == Ci.sbIMediacoreSequencer.MODE_CUSTOM) {
      gMM.sequencer.mode = Ci.sbIMediacoreSequencer.MODE_FORWARD;
    }

    // Start playing this queue if possible
    if (this._view.length > 0) {
      gMM.sequencer.playView(this._view, aIndex);

      // Get the sequence off the sequencer
      this._mediacoreSequence = getMediacoreSequence();

      // internal sequence is the same as the mediacore sequence, since the user
      // hasn't had the chance to alter it yet
      this._sequence = this._mediacoreSequence;
      this._customized = false;
    }
    else {
      // This is a blank queue
      this._mediacoreSequence = [];
      this._sequence = [];
      this._customized = false;
    }

    this._view.addListener(this);
    
    this._initialized = true;

    // Notify the world of this queue
    var event = new NowPlayingEvent(Ci.sbINowPlayingEvent.QUEUE_START, this);
    gNPS.QueryInterface(Ci.sbINowPlayingEventTarget);
    gNPS.dispatchEvent(event);
  },
  
  /* sbINowPlayingQueue */
  destroy : function() {
    this._view.removeListener(this);

    this._view = null;
    this._privateList = null;
    this._initialized = false;

    gMM.removeListener(this);

    this._queuedViews = null;

    // Notify the world that this queue is gone
    var event = new NowPlayingEvent(Ci.sbINowPlayingEvent.QUEUE_END, this);
    gNPS.QueryInterface(Ci.sbINowPlayingEventTarget);
    gNPS.dispatchEvent(event);
  },


  /* sbINowPlayingQueue */
  get forwardSequence() {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }

    var newArray = this._sequence.slice(0);
    return ArrayConverter.nsIArray(newArray);
  },


  // Convienience method for scripts, returns a JS array instead of an nsIArray
  get forwardSequenceJS() {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }

    return this._sequence.slice(0);
  },
  
  /* sbINowPlayingQueue */
  get view() {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    
    return this._view;
  },
  
  /* sbINowPlayingQueue */
  get customized() {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    
    return this._customized;
  },


  /* sbINowPlayingQueue */
  getBindableView : function() {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    
    var queuedView = new QueuedMediaListView(this._view, this);
    this._queuedViews.push(queuedView);
    
    // Make the bindable view a listener so it knows when to destroy itself
    gNPS.addListener(queuedView);
    
    return queuedView;
  },


  /* sbINowPlayingQueue */
  getMediaList : function(aName) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    
    var library = LibraryUtils.mainLibrary;
    var list = library.createMediaList("simple");
    list.name = aName;
    
    var items = [];
    for (var i = 0; i < this._sequence.length; ++i) {
      // javascript is slow ...
      var index = this._sequence[i];
      items.push(this._view.getItemByIndex(index));
    }
    var enumerator = ArrayConverter.enumerator(items);
    list.addSome(enumerator);

    return list;
  },


  /* sbINowPlayingQueue */
  showCurrentTrack : function() {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }

    var highlightIndex = gMM.sequencer.sequencePosition;

    for (var i = 0; i < this._queuedViews.length; i++) {
      var view = this._queuedViews[i];
      if (view && view.treeView.treeBoxObject) {
        view.treeView.treeBoxObject.ensureRowIsVisible(highlightIndex);
        view.treeView.selection.select(highlightIndex);
      }
    }
  },



  // The next ten methods modify the queue. They cause the final state of the
  // queue to be custom. For example, the user is playing a shuffled queue, then
  // moves a track to a different position. The new sequence will be nearly
  // identical to the shuffled sequence (as reported by the mediacore sequencer)
  // with that one alteration. The shuffle button should change from shuffled to
  // straight, which is actually MODE_CUSTOM now.
  


  /* sbINowPlayingQueue */
  add : function(aMediaItem) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("add(item  = " + aMediaItem + ")");

    this._modifyQueue(
      function() {
        var insertedViewPosition = this._sequence.length;
        this._sequence.push(insertedViewPosition);

        this._privateList.add(aMediaItem);
      }
    );
  },

  /* sbINowPlayingQueue */
  addSome : function(aMediaItems) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("addSome(items = " + aMediaItems + ")");



    this._modifyQueue(
      function() {
        // Append the items to the end of the list, do this before we modify the
        // sequence to figure out how many items were added
        var oldLength = this._privateList.length;
        this._privateList.addSome(aMediaItems);
        var numAdded = this._privateList.length - oldLength;

        // Make sure that in the sequence the item gets played where it is specified
        var insertedViewPosition = this._sequence.length;
        for (var i = insertedViewPosition; i < insertedViewPosition + numAdded; ++i) {
          this._sequence.push(i);
        }
      }
    );
  },

  /* sbINowPlayingQueue */
  addAll : function(aMediaList) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("addAll(items = " + aMediaList + ")");



    this._modifyQueue(
      function() {
        // Append the items to the end of the list, do this before we modify the
        // sequence to figure out how many items were added
        this._privateList.addAll(aMediaList);
        var numAdded = aMediaList.length;

        // Make sure that in the sequence the item gets played where it is specified
        var insertedViewPosition = this._sequence.length;
        for (var i = insertedViewPosition; i < insertedViewPosition + numAdded; ++i) {
          this._sequence.push(i);
        }
      }
    );
  },

  /* sbINowPlayingQueue */
  remove : function(aIndex) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("remove(index = " + aIndex + ")");



    this._modifyQueue(
      function() {
        var removedViewPosition = this._sequence[aIndex];
        this._sequence.splice(aIndex, 1);
        for (var i = 0; i < this._sequence.length; ++i) {
          if (this._sequence[i] > removedViewPosition) {
            --this._sequence[i];
          }
        }

        this._privateList.removeByIndex(removedViewPosition);
      }
    );
  },

  /* sbINowPlayingQueue */
  removeSome : function(aIndexArray, aIndexArrayCount) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("removeSome(indices = " + aIndexArray + ")");



    this._modifyQueue(
      function() {
        // convert sequence positions to view positions
        function sequenceToViewPosition(index) {
          return this._sequence[index];
        }
        var viewPositions = aIndexArray.map(sequenceToViewPosition, this);

        // Descending order so view positions don't move about as they are removed
        viewPositions.sort(function(a, b) { return b - a; });

        for (var i = 0; i < aIndexArrayCount; ++i) {
          var removedViewPosition = viewPositions[i];
          var removedSequencePosition = this._sequence.indexOf(removedViewPosition);

          this._sequence.splice(removedSequencePosition, 1);
          for (var j = 0; j < this._sequence.length; ++j) {
            if (this._sequence[j] > removedViewPosition) {
              --this._sequence[j];
            }
          }

          this._privateList.removeByIndex(removedViewPosition);
        }
      }
    );
  },

  /* sbINowPlayingQueue */
  clear : function() {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("clear()");



    this._modifyQueue(
      function() {
        this._sequence = [];
        this._privateList.clear();
      }
    );
  },

  /* sbINowPlayingQueue */
  insertAt : function(aMediaItem, aIndex) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("insertAt(item  = " + aMediaItem + ",");
    LOG("         index = " + aIndex + ")");

    this._modifyQueue(
      function() {
        // Make sure that in the sequence the item gets played where it is specified
        var insertedViewPosition = this._sequence.length;
        this._sequence.splice(aIndex, 0, insertedViewPosition);

        this._privateList.add(aMediaItem);
      }
    );
  },

  /* sbINowPlayingQueue */
  moveTo : function(aFromIndex, aToIndex) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("moveTo(fromIndex = " + aFromIndex + ",");
    LOG("       toIndex   = " + aToIndex + ")");



    this._modifyQueue(
      function() {
        var removed = this._sequence.splice(aFromIndex, 1);
        if (aFromIndex < aToIndex) {
          this._sequence.splice(aToIndex - 1, 0, removed[0]);
        }
        else {
          this._sequence.splice(aToIndex, 0, removed[0]);
        }
      }
    );
  },

  /* sbINowPlayingQueue */
  moveLast : function(aFromIndex) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("moveLast(fromIndex = " + aFromIndex + ")");



    this._modifyQueue(
      function() {
        var removed = this._sequence.splice(aFromIndex, 1);
        this._sequence.push(removed[0]);
      }
    );
  },

  /* sbINowPlayingQueue */
  insertSomeAt : function(aMediaItems, aIndex) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("insertSomeAt(items = " + aMediaItems + ",");
    LOG("             index = " + aIndex + ")");

    this._modifyQueue(
      function() {
        // Append the items to the end of the list, do this before we modify the
        // sequence to figure out how may items were added
        var oldLength = this._privateList.length;
        this._privateList.addSome(aMediaItems);
        var numAdded = this._privateList.length - oldLength;

        // Make sure that in the sequence the item gets played where it is specified
        var insertedViewPosition = this._sequence.length;
        for (var i = insertedViewPosition; i < insertedViewPosition + numAdded; ++i) {
          this._sequence.splice(aIndex, 0, i);
          ++aIndex;
        }
      }
    );
  },

  /* sbINowPlayingQueue */
  moveSomeTo : function(aFromIndexArray, aFromIndexArrayCount, aToIndex) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("moveSomeTo(fromIndexArray = " + aFromIndexArray + ",");
    LOG("           toIndex        = " + aToIndex + ")");



    this._modifyQueue(
      function() {
        var removed = [];
        for (var i = aFromIndexArrayCount - 1; i >= 0; i--) {
          var fromIndex = aFromIndexArray[i];
          removed.push(this._sequence.splice(fromIndex, 1)[0]);
          if (fromIndex < aToIndex) {
            aToIndex--;
          }
        }
        for (var i = 0; i < removed.length; i++) {
          this._sequence.splice(aToIndex, 0, removed[i]);
        }
      }
    );
  },

  /* sbINowPlayingQueue */
  moveSomeLast : function(aFromIndexArray, aFromIndexArrayCount) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("moveSomeLast(fromIndexArray = " + aFromIndexArray + ")");



    this._modifyQueue(
      function() {
        var removed = [];
        for (var i = aFromIndexArrayCount - 1; i >= 0; i--) {
          var fromIndex = aFromIndexArray[i];
          removed.push(this._sequence.splice(fromIndex, 1)[0]);
        }
        for (var i = removed.length - 1; i >= 0; i--) {
          this._sequence.push(removed[i]);
        }
      }
    );
  },

  _modifyQueue : function(func) {
    this._sequence = this._mediacoreSequence;
    this._ignoreSequenceChangeEvents = true;

    if (this._view.currentSort &&
        this._view.currentSort.getPropertyAt(0).id != SBProperties.ordinal) {
      // convert sorted view positions to unfiltered view positions
      function unfilter(index) {
        return this._view.getUnfilteredIndex(index);
      }
      this._sequence = this._sequence.map(unfilter, this);
      var sortArray = Cc["@songbirdnest.com/Songbird/Properties/MutablePropertyArray;1"]
                      .createInstance(Ci.sbIMutablePropertyArray);
      sortArray.strict = false;
      sortArray.appendProperty(SBProperties.ordinal, "a");
      this._view.setSort(sortArray);
    }



    // Action specific stuff
    func.call(this);



    // The queue has been modified, regardless of whether it was shuffled or
    // not, it is now custom
    this._ignoreSequenceChangeEvents = false;
    var generator = new NowPlayingSequenceGenerator(this._sequence);
    gMM.sequencer.customGenerator = generator;
    gMM.sequencer.mode = Ci.sbIMediacoreSequencer.MODE_CUSTOM;

    this._customized = true;
  },

  /* sbINowPlayingQueue */
  dropSomeExternal : function(aWindow,
                              aDragSession,
                              aDropPosition) {
    if (!this._initialized) {
      throw new CE("Attempted to access uninitialized queue!",
                   Cr.NS_ERROR_NOT_INITIALIZED);
    }
    LOG("dropSomeExternal()");
  

    var self = this;
    var dropPosition = aDropPosition;
    var dropHandlerListener = {
      oldLength : this._privateList.length,
      onDropComplete: function(aTargetList,
                               aImportedInLibrary,
                               aDuplicates,
                               aInsertedInMediaList,
                               aOtherDropsHandled) { 
        var numAdded = self._privateList.length - this.oldLength;

        // Make sure that in the sequence the item gets played where it is specified
        var insertedViewPosition = self._sequence.length;
        for (var i = insertedViewPosition; i < insertedViewPosition + numAdded; ++i) {
          if (dropPosition > -1) {
            self._sequence.splice(dropPosition, 0, i);
            dropPosition++;
          }
          else {
            self._sequence.push(i);
          }
        }



        // The queue has been modified, regardless of whether it was shuffled or
        // not, it is now custom
        self._ignoreSequenceChangeEvents = false;
        var generator = new NowPlayingSequenceGenerator(self._sequence);
        gMM.sequencer.customGenerator = generator;
        gMM.sequencer.mode = Ci.sbIMediacoreSequencer.MODE_CUSTOM;

        self._customized = true;



        // show the standard report on the status bar
        return true; 
      },
      onFirstMediaItem: function(aTargetList, aFirstMediaItem) {}
    };



    this._sequence = this._mediacoreSequence;
    this._ignoreSequenceChangeEvents = true;

    if (this._view.currentSort &&
        this._view.currentSort.getPropertyAt(0).id != SBProperties.ordinal) {
      // convert sorted view positions to unfiltered view positions
      function unfilter(index) {
        return this._view.getUnfilteredIndex(index);
      }
      this._sequence = this._sequence.map(unfilter, this);
      var sortArray = Cc["@songbirdnest.com/Songbird/Properties/MutablePropertyArray;1"]
                      .createInstance(Ci.sbIMutablePropertyArray);
      sortArray.strict = false;
      sortArray.appendProperty(SBProperties.ordinal, "a");
      this._view.setSort(sortArray);
    }



    // Append the items to the end of the list, do this before we modify the
    // sequence to figure out how many items were added
    ExternalDropHandler._dropFiles(aWindow,
                                   aDragSession, 
                                   null,
                                   this._privateList, 
                                   -1, 
                                   dropHandlerListener);
  },


  
  /* sbIMediacoreEventListener */
  onMediacoreEvent: function(aEvent) {
    switch (aEvent.type) {
      case Ci.sbIMediacoreEvent.STREAM_STOP :
      case Ci.sbIMediacoreEvent.STREAM_END :
        break;
      case Ci.sbIMediacoreEvent.SEQUENCE_CHANGE :
        if (!this._ignoreSequenceChangeEvents)
          this._onSequenceChange(aEvent.data);
        break;
    }
  },

  _onSequenceChange : function(aSequence) {
    if (!gMM.sequencer.view.mediaList.equals(this._privateList))
      return;

    // Get the sequence off the sequencer
    this._mediacoreSequence = getMediacoreSequence();

    if (gMM.sequencer.mode != Ci.sbIMediacoreSequencer.MODE_CUSTOM) {
      this._sequence = this._mediacoreSequence;
      this._customized = false;
    }

    for (var i = 0; i < this._queuedViews.length; i++) {
      var view = this._queuedViews[i];
      if (view && view.treeView.treeBoxObject) {
         view.treeView.treeBoxObject.invalidate();
      }
    }
  },



  /* sbIMediaListViewListener */
  onFilterChanged : function(aChangedView) { },

  /* sbIMediaListViewListener */
  onSearchChanged : function(aChangedView) { },

  /* sbIMediaListViewListener */
  onSortChanged : function(aChangedView) {
    // Unshuffle the queue
    gMM.sequencer.mode = Ci.sbIMediacoreSequencer.MODE_FORWARD;

    // Propogate changes to the sort to the trees
    for (var i = 0; i < this._queuedViews.length; i++) {
      var view = this._queuedViews[i];
      if (view) {
         view.setSort(aChangedView.currentSort);
      }
    }
  }
};




/* 
 * -----------------------------------------------------------------------------
 * Queued Media List View Component 
 * -----------------------------------------------------------------------------
 */

function QueuedMediaListView(aMasterView, aQueue) {

  // We have to clone the view because of the 1-1 mapping between views and
  // trees
  this._view = aMasterView.clone();

  this._queue = aQueue;

  this._treeView  = new QueuedTreeView(this._view.treeView, aMasterView.treeView, aQueue);
  this._selection = new QueuedMediaListViewSelection(this._view, aQueue);

  this.wrappedJSObject = this;
}
QueuedMediaListView.prototype = {
  destroy : function() {
    this._view = null;
    this._queue = null;
    
    this._treeView.destroy();
    this._selection.destroy();
  },



  get queue() {
    return this._queue;
  },



  /* sbIMediaListView */
  get mediaList() {
    return this._view.mediaList;
  },

  /* sbIMediaListView */
  get length() {
    return this._view.length;
  },

  /* sbIMediaListView */
  get treeView() {
    return this._treeView;
  },

  /* sbIMediaListView */
  get cascadeFilterSet() {
    return this._view.cascadeFilterSet;
  },

  /* sbIMediaListView */
  getItemByIndex : function(aIndex) {
    aIndex = this._viewPosition(aIndex);
    return this._view.getItemByIndex(aIndex);
  },
  
  /* sbIMediaListView */
  getIndexForItem : function(aMediaItem) {
    var index = this._view.getIndexForItem(aMediaItem);
    return this._sequencePosition(index);
  },
  
  /* sbIMediaListView */
  getUnfilteredIndex : function(aIndex) {
    aIndex = this._viewPosition(aIndex);
    return this._view.getUnfilteredIndex(aIndex);
    // XXX Convert to sequence again here?
  },

  /* sbIMediaListView */
  getViewItemUIDForIndex : function(aIndex) {
    aIndex = this._viewPosition(aIndex);
    return this._view.getViewItemUIDForIndex(aIndex);
  },

  /* sbIMediaListView */
  getIndexForViewItemUID : function(aViewItemUID) {
    var index = getIndexForViewItemUID(aViewItemUID);
    return this._sequencePosition(index);
  },

  /* sbIMediaListView */
  getDistinctValuesForProperty : function(aPropertyID) {
    return this._view.getDistinctValuesForProperty(aPropertyID);
  },
  
  /* sbIMediaListView */
  clone : function() {
    return new QueuedMediaListView(this._view.clone(), this._queue);
  },

  /* sbIMediaListView */
  getState : function() {
    return this._view.getState();
  },

  /* sbIMediaListView */
  addListener : function(aListener, aOwnsWeak) {
    if (!aOwnsWeak) aOwnsWeak = false;
    this._view.addListener(aListener, aOwnsWeak);
  },
  
  /* sbIMediaListView */
  removeListener : function(aListener) {
    this._view.removeListener(aListener);
  },
  
  /* sbIMediaListView */
  get selection() {
    return this._selection;
  },
  
  /* sbIMediaListView */
  removeSelectedMediaItems : function() {
    // This should work without any conversion...
    this._view.removeSelectedMediaItems();
  },



  /* sbISortableMediaListView */
  get sortableProperties() {
    return this._view.sortableProperties;
  },

  /* sbISortableMediaListView */
  get currentSort() {
    return this._view.currentSort;
  },

  /* sbISortableMediaListView */
  setSort : function(aSort) {
    this._view.setSort(aSort);
  },

  /* sbISortableMediaListView */
  clearSort : function() {
    this._view.clearSort();
  },



  /* sbINowPlayingEventListener */
  onQueueStart : function(aQueue) { },

  /* sbINowPlayingEventListener */
  onQueueEnd : function(aQueue) {
    if (aQueue == this._queue) {
      gNPS.removeListener(this);
      this.destroy();
    }
  },




  _viewPosition : function(index) {
    if (gMM.sequencer.mode == Ci.sbIMediacoreSequencer.MODE_SHUFFLE) {
      return this._queue.mediacoreSequence[index];
    }
    return this._queue.forwardSequenceJS[index];
  },

  _sequencePosition : function(index) {
    if (gMM.sequencer.mode == Ci.sbIMediacoreSequencer.MODE_SHUFFLE) {
      return this._queue.mediacoreSequence.indexOf(index);
    }
    return this._queue.forwardSequenceJS.indexOf(index);
  },



  QueryInterface:
    XPCOMUtils.generateQI([Ci.sbIMediaListView,
                           Ci.sbISortableMediaListView,
                           Ci.sbINowPlayingEventListener])
};




/* 
 * -----------------------------------------------------------------------------
 * Queued Tree View Component 
 * -----------------------------------------------------------------------------
 */

function QueuedTreeView(aTreeView, aMasterTreeView, aQueue) {
  this._treeView = aTreeView;
  this._masterTreeView = aMasterTreeView;
  this._selection = null;
  this._queue = aQueue;
  this._tree = null;

  this.wrappedJSObject = this;
}
QueuedTreeView.prototype = {
  destroy : function() {
    this._treeView = null;
    this._masterTreeView = null;
    this._queue = null;
    this._tree = null;

    this._selection.destroy();
  },



  /* nsITreeView */
  get rowCount() {
    return this._treeView.rowCount;
  },

  /* nsITreeView */
  get selection() {
    return this._selection;
  },

  /* nsITreeView */
  set selection(val) {
    this._treeView.selection = val;
    this._selection = new QueuedTreeSelection(this._treeView, this._queue);
  },


  /* nsITreeView */
  getRowProperties : function(index, properties) {
    var viewPosition = this._viewPosition(index);
    this._treeView.getRowProperties(viewPosition, properties);
    
    try {
      var sequencePosition = gMM.sequencer.sequencePosition;
      if (index < sequencePosition) {
        var aserv = Components.classes["@mozilla.org/atom-service;1"]
                    .getService(Components.interfaces.nsIAtomService);
        properties.AppendElement(aserv.getAtom("alreadyPlayed"));
      }
    }
    catch (e) {
      // Not really important if this fails
    }
  },

  /* nsITreeView */
  getCellProperties : function(row, col, properties) {
    var viewPosition = this._viewPosition(row);
    this._treeView.getCellProperties(viewPosition, col, properties);
    
    try {
      var sequencePosition = gMM.sequencer.sequencePosition;
      if (row < sequencePosition) {
        var aserv = Components.classes["@mozilla.org/atom-service;1"]
                    .getService(Components.interfaces.nsIAtomService);
        properties.AppendElement(aserv.getAtom("alreadyPlayed"));
      }
    }
    catch (e) {
      // Not really important if this fails
    }
  },

  /* nsITreeView */
  getColumnProperties : function(col, properties) {
    this._treeView.getColumnProperties(col, properties);
  },

  /* nsITreeView */
  isContainer : function(index) {
    index = this._viewPosition(index);
    return this._treeView.isContainer(index);
  },

  /* nsITreeView */
  isContainerOpen : function(index) {
    index = this._viewPosition(index);
    return this._treeView.isContainerOpen(index);
  },

  /* nsITreeView */
  isContainerEmpty : function(index) {
    index = this._viewPosition(index);
    return this._treeView.isContainerEmpty(index);
  },

  /* nsITreeView */
  isSeparator : function(index) {
    index = this._viewPosition(index);
    return this._treeView.isSeparator(index);
  },

  /* nsITreeView */
  isSorted : function() {
    return this._treeView.isSorted();
  },

  /* nsITreeView */
  canDrop : function(index, orientation) {
    // This method forwards these parameters to eqivilant methods in <playlist>,
    // which is expecting sequence coordinates
    return this._treeView.canDrop(index, orientation);
  },

  /* nsITreeView */
  drop : function(row, orientation) {
    // This method forwards these parameters to eqivilant methods in <playlist>,
    // which is expecting sequence coordinates
    this._treeView.drop(row, orientation);
  },

  /* nsITreeView */
  getParentIndex : function(rowIndex) {
    rowIndex = this._viewPosition(rowIndex);
    return this._treeView.getParentIndex(rowIndex);
  },

  /* nsITreeView */
  hasNextSibling : function(rowIndex, afterIndex) {
    rowIndex = this._viewPosition(rowIndex);
    return this._treeView.hasNextSibling(rowIndex, afterIndex);
  },

  /* nsITreeView */
  getLevel : function(index) {
    index = this._viewPosition(index);
    return this._treeView.getLevel(index);
  },

  /* nsITreeView */
  getImageSrc : function(row, col) {
    row = this._viewPosition(row);
    return this._treeView.getImageSrc(row, col);
  },

  /* nsITreeView */
  getProgressMode : function(row, col) {
    row = this._viewPosition(row);
    return this._treeView.getProgressMode(row, col);
  },

  /* nsITreeView */
  getCellValue : function(row, col) {
    row = this._viewPosition(row);
    return this._treeView.getCellValue(row, col);
  },

  /* nsITreeView */
  getCellText : function(row, col) {
    row = this._viewPosition(row);
    return this._treeView.getCellText(row, col);
  },

  /* nsITreeView */
  setTree : function(tree) {
    // Save a reference to the tree box object so we can manually invalidate it
    this._tree = tree;

    this._treeView.setTree(tree);
  },

  /* nsITreeView */
  toggleOpenState : function(index) {
    index = this._viewPosition(index);
    this._treeView.toggleOpenState(index);
  },

  /* nsITreeView */
  cycleHeader : function(col) {
    // Change the sort on the master view, changes will propogate to the bound
    // views
    this._masterTreeView.cycleHeader(col);
  },

  /* nsITreeView */
  selectionChanged : function() {
    this._treeView.selectionChanged();
  },

  /* nsITreeView */
  cycleCell : function(row, col) {
    row = this._viewPosition(row);
    this._treeView.cycleCell(row, col);
  },

  /* nsITreeView */
  isEditable : function(row, col) {
    row = this._viewPosition(row);
    return this._treeView.isEditable(row, col);
  },

  /* nsITreeView */
  isSelectable : function(row, col) {
    return this._treeView.isSelectable(row, col);
  },

  /* nsITreeView */
  setCellValue : function(row, col, value) {
    row = this._viewPosition(row);
    this._treeView.setCellValue(row, col, value);
  },

  /* nsITreeView */
  setCellText : function(row, col, value) {
    row = this._viewPosition(row);
    this._treeView.setCellText(row, col, value);
  },

  /* nsITreeView */
  performAction : function(action) {
    this._treeView.performAction(action);
  },

  /* nsITreeView */
  performActionOnRow : function(action, row) {
    row = this._viewPosition(row);
    this._treeView.performActionOnRow(action, row);
  },

  /* nsITreeView */
  performActionOnCell : function(action, row, col) {
    row = this._viewPosition(row);
    this._treeView.performActionOnCell(action, row, col);
  },



  /* sbIMediaListViewTreeView */
  get observer() {
    return this._treeView.observer;
  },

  /* sbIMediaListViewTreeView */
  set observer(val) {
    this._treeView.observer = val;
  },

  /* sbIMediaListViewTreeView */
  getNextRowIndexForKeyNavigation : function(aKeyString, aStartFrom) {
    var index = this._treeView.getNextRowIndexForKeyNavigation(aKeyString, aStartFrom);
    return this._sequencePosition(index);
  },



  /* sbILocalDatabaseTreeView */
  get selectionIsAll() {
    return this._treeView.selectionIsAll;
  },

  /* sbILocalDatabaseTreeView */
  setSort : function(aProperty, aDirection) {
    this._treeView.setSort(aProperty, aDirection);
  },

  /* sbILocalDatabaseTreeView */
  invalidateRowsByGuid : function(aGuid) {
    this._treeView.invalidateRowsByGuid(aGuid);
  },

  /* sbILocalDatabaseTreeView */
  setMouseState : function(aRow, aColumn, aState) {
    aRow = (aRow == -1) ? -1 : this._viewPosition(aRow);
    //aRow = this._viewPosition(aRow);
    this._treeView.setMouseState(aRow, aColumn, aState);
  },

  /* sbILocalDatabaseTreeView */
  getSelectedValues : function() {
    return this._treeView.getSelectedValues();
  },





  get treeBoxObject() {
    return this._tree;
  },



  _viewPosition : function(index) {
    if (gMM.sequencer.mode == Ci.sbIMediacoreSequencer.MODE_SHUFFLE) {
      return this._queue.mediacoreSequence[index];
    }
    return this._queue.forwardSequenceJS[index];
  },

  _sequencePosition : function(index) {
    if (gMM.sequencer.mode == Ci.sbIMediacoreSequencer.MODE_SHUFFLE) {
      return this._queue.mediacoreSequence.indexOf(index);
    }
    return this._queue.forwardSequenceJS.indexOf(index);
  },



  QueryInterface:
    XPCOMUtils.generateQI([Ci.nsITreeView,
                           Ci.sbIMediaListViewTreeView,
                           Ci.sbILocalDatabaseTreeView])
};




/* 
 * -----------------------------------------------------------------------------
 * Queued Tree Selection Component 
 * -----------------------------------------------------------------------------
 */

function QueuedTreeSelection(aTreeView, aQueue) {
  this._treeView = aTreeView;
  this._selection = aTreeView.selection;
  this._queue = aQueue;

  this._shiftSelectPivot = -1;
}
QueuedTreeSelection.prototype = {
  destroy : function() {
    this._treeView = null;
    this._selection = null;
    this._queue = null;
  },



  /* nsITreeSelection */
  get tree() {
    return this._selection.tree;
  },

  /* nsITreeSelection */
  set tree(val) {
    this._selection.tree = val;
  },

  /* nsITreeSelection */
  get single() {
    return this._selection.single;
  },

  /* nsITreeSelection */
  get count() {
    return this._selection.count;
  },

  /* nsITreeSelection */
  isSelected : function(index) {
    index = this._viewPosition(index);
    return this._selection.isSelected(index);
  },

  /* nsITreeSelection */
  select : function(index) {
    this._shiftSelectPivot = -1;

    index = this._viewPosition(index);
    return this._selection.select(index);
  },

  /* nsITreeSelection */
  timedSelect : function(index, delay) {
    this._shiftSelectPivot = -1;

    index = this._viewPosition(index);
    return this._selection.timedSelect(index, delay);
  },

  /* nsITreeSelection */
  toggleSelect : function(index) {
    this._shiftSelectPivot = -1;

    index = this._viewPosition(index);
    return this._selection.toggleSelect(index);
  },

  /* nsITreeSelection */
  rangedSelect : function(startIndex, endIndex, augment) {
    // Save the current index here since we need it later and it may be
    // changed if we need to clear the selection
    var curIndex = this.currentIndex;

    if (!augment) {
      this._selection.clearSelection();
    }

    if (startIndex == -1) {
      if (this._shiftSelectPivot != -1) {
        startIndex = this._shiftSelectPivot;
      }
      else {
        if (curIndex != -1) {
          startIndex = curIndex;
        }
        else {
          startIndex = endIndex;
        }
      }
    }

    this._shiftSelectPivot = startIndex;

    if (startIndex > endIndex) {
      var tmp = endIndex;
      endIndex = startIndex;
      startIndex = tmp;
    }
    for (var i = startIndex; i <= endIndex; ++i) {
      var index = this._viewPosition(i);
      if (!this._selection.isSelected(index)) {
        this._selection.toggleSelect(index);
      }
    }
  },

  /* nsITreeSelection */
  clearRange : function(startIndex, endIndex) {
    this._shiftSelectPivot = -1;

    if (startIndex > endIndex) {
      var tmp = endIndex;
      endIndex = startIndex;
      startIndex = tmp;
    }
    for (var i = startIndex; i <= endIndex; ++i) {
      var index = this._viewPosition(i);
      if (this._selection.isSelected(index)) {
        this._selection.toggleSelect(index);
      }
    }
  },

  /* nsITreeSelection */
  clearSelection : function() {
    this._shiftSelectPivot = -1;

    return this._selection.clearSelection();
  },

  /* nsITreeSelection */
  invertSelection : function() {
    return this._selection.invertSelection();
  },

  /* nsITreeSelection */
  selectAll : function() {
    this._shiftSelectPivot = -1;

    return this._selection.selectAll();
  },

  /* nsITreeSelection */
  getRangeCount : function() {
    // Not implemented anyway
    return this._selection.getRangeCount();
  },

  /* nsITreeSelection */
  getRangeAt : function(i, min, max) {
    // Not implemented anyway
    return this._selection.getRangeAt(i, min, max);
  },

  /* nsITreeSelection */
  invalidateSelection : function() {
    return this._selection.invalidateSelection();
  },

  /* nsITreeSelection */
  adjustSelection : function(index, count) {
    // too complicated to work out what actually changed, adjust everything
    return this._selection.adjustSelection(0, this._treeView.rowCount);
  },

  /* nsITreeSelection */
  get selectEventsSuppressed() {
    return this._selection.selectEventsSuppressed;
  },

  /* nsITreeSelection */
  set selectEventsSuppressed(val) {
    this._selection.selectEventsSuppressed = val;
  },

  /* nsITreeSelection */
  get currentIndex() {
    return this._sequencePosition(this._selection.currentIndex);
  },

  /* nsITreeSelection */
  set currentIndex(val) {
    this._selection.currentIndex = this._viewPosition(val);
  },

  /* nsITreeSelection */
  get currentColumn() {
    return this._selection.currentColumn;
  },

  /* nsITreeSelection */
  set currentColumn(val) {
    this._selection.currentColumn = val;
  },

  /* nsITreeSelection */
  get shiftSelectPivot() {
    return this._shiftSelectPivot;
  },




  _viewPosition : function(index) {
    if (gMM.sequencer.mode == Ci.sbIMediacoreSequencer.MODE_SHUFFLE) {
      return this._queue.mediacoreSequence[index];
    }
    return this._queue.forwardSequenceJS[index];
  },

  _sequencePosition : function(index) {
    if (gMM.sequencer.mode == Ci.sbIMediacoreSequencer.MODE_SHUFFLE) {
      return this._queue.mediacoreSequence.indexOf(index);
    }
    return this._queue.forwardSequenceJS.indexOf(index);
  },



  QueryInterface:
    XPCOMUtils.generateQI([Ci.nsITreeSelection])
};




/* 
 * -----------------------------------------------------------------------------
 * Queued Media List View Selection Component 
 * -----------------------------------------------------------------------------
 */

function QueuedMediaListViewSelection(aView, aQueue) {
  this._view = aView;
  this._selection = aView.selection;
  this._queue = aQueue;
}
QueuedMediaListViewSelection.prototype = {
  destroy : function() {
    this._view = null;
    this._selection = null;
    this._queue = null;
  },



  /* sbIMediaListViewSelection */
  get count() {
    return this._selection.count;
  },
  
  /* sbIMediaListViewSelection */
  get currentIndex() {
    return this._sequencePosition(this._selection.currentIndex);
  },
  
  /* sbIMediaListViewSelection */
  get currentMediaItem() {
    return this._selection.currentMediaItem;
  },
  
  /* sbIMediaListViewSelection */
  isIndexSelection : function(aIndex) {
    aIndex = this._viewPositon(aIndex);
    return this._selection.isIndexSelected(aIndex);
  },
  
  /* sbIMediaListViewSelection */
  get selectedIndexedMediaItems() {
    var enumerator = this._selection.selectedIndexedMediaItems;
    
    var array = [];
    while (enumerator.hasMoreElements()) {
      var element = enumerator.getNext();
      var i = this._sequencePosition(element.index);
      var item = this._view.getItemByIndex(i);
      array.push({
        index : i,
        mediaItem : item,
        QueryInterface : XPCOMUtils.generateQI([Ci.sbIIndexedMediaItem])
      });
    }
    array.sort(function(a,b){return a.index - b.index});
    
    return ArrayConverter.enumerator(array);
  },
  
  /* sbIMediaListViewSelection */
  get selectedMediaItems() {
    return this._selection.selectedMediaItems;
  },
  
  /* sbIMediaListViewSelection */
  select : function(aIndex) {
    aIndex = this._viewPosition(aIndex);
    this._selection.select(aIndex);
  },
  
  /* sbIMediaListViewSelection */
  selectOnly : function(aIndex) {
    aIndex = this._viewPosition(aIndex);
    this._selection.selectOnly(aIndex);
  },
  
  /* sbIMediaListViewSelection */
  toggle : function(aIndex) {
    aIndex = this._viewPosition(aIndex);
    this._selection.toggle(aIndex);
  },
  
  /* sbIMediaListViewSelection */
  clear : function(aIndex) {
    aIndex = this._viewPosition(aIndex);
    this._selection.clear(aIndex);
  },
  
  /* sbIMediaListViewSelection */
  selectRange : function(aStartIndex, aEndIndex) {
    if (startIndex > endIndex) {
      var tmp = endIndex;
      endIndex = startIndex;
      startIndex = tmp;
    }
    for (var i = aStartIndex; i <= aEndIndex; ++i) {
      var index = this._viewPosition(i);
      this._selection.select(index);
    }
  },
  
  /* sbIMediaListViewSelection */
  clearRange : function(aStartIndex, aEndIndex) {
    if (startIndex > endIndex) {
      var tmp = endIndex;
      endIndex = startIndex;
      startIndex = tmp;
    }
    for (var i = aStartIndex; i <= aEndIndex; ++i) {
      var index = this._viewPosition(i);
      this._selection.clear(index);
    }
  },
  
  /* sbIMediaListViewSelection */
  selectNone : function() {
    this._.selection.selectNone();
  },
  
  /* sbIMediaListViewSelection */
  selectAll : function() {
    this._selection.selectAll();
  },
  
  /* sbIMediaListViewSelection */
  addListener : function(aListener) {
    this._selection.addListener(aListener);
  },
  
  /* sbIMediaListViewSelection */
  removeListener : function(aListener) {
    this._selection.removeListener(aListener);
  },
  
  /* sbIMediaListViewSelection */
  get selectionNotificationsSuppressed() {
    return this._selection.selectionNotificationsSuppressed;
  },
  
  /* sbIMediaListViewSelection */
  set selectionNotificationsSuppressed(val) {
    this._selection.selectionNotificationsSuppressed = val;
  },




  _viewPosition : function(index) {
    if (gMM.sequencer.mode == Ci.sbIMediacoreSequencer.MODE_SHUFFLE) {
      return this._queue.mediacoreSequence[index];
    }
    return this._queue.forwardSequenceJS[index];
  },

  _sequencePosition : function(index) {
    if (gMM.sequencer.mode == Ci.sbIMediacoreSequencer.MODE_SHUFFLE) {
      return this._queue.mediacoreSequence.indexOf(index);
    }
    return this._queue.forwardSequenceJS.indexOf(index);
  },



  QueryInterface:
    XPCOMUtils.generateQI([Ci.sbIMediaListViewSelection])
};




// XPCOM Registration
function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([sbNowPlayingQueue]);
}




// helper functions

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

function getMediacoreSequence() {
  var sequence = gMM.sequencer.currentSequence;
  var array = [];
  var enumerator = sequence.enumerate();
  while (enumerator.hasMoreElements()) {
    array.push(enumerator.getNext()
                         .QueryInterface(Ci.nsISupportsPRUint32)
                         .data);
  }
  return array;
}
