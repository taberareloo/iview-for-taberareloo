/* jshint -W117, loopfunc:true, scripturl:true, expr:true */
// ==Taberareloo==
// {
//   "name"        : "iview for Taberareloo"
// , "description" : "iview for Taberareloo"
// , "include"     : ["background", "content"]
// , "match"       : ["http://yungsang.github.io/iview-for-taberareloo/*"]
// , "version"     : "1.9.2"
// , "downloadURL" : "http://yungsang.github.io/iview-for-taberareloo/iview.for.taberareloo.tbrl.js"
// }
// ==/Taberareloo==

// Forked from https://github.com/ku/iview-for-tombloo
//
// Copyright (c) KUMAGAI Kentaro ku0522a*gmail.com
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
//
//
// 1. Redistributions of source code must retain the above copyright
//    notice, this list of conditions and the following disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in the
//    documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//

(function () {
  'use strict';

  var IVIEW_URL    = 'http://yungsang.github.io/iview-for-taberareloo/';
  var SITEINFO_URL = 'http://wedata.github.io/iview/items.json';

  var settings = {};

  if (inContext('background')) {
    Patches.require = Patches.require || function (url, delay) {
      var name = window.url.parse(url).path.split(/[\/\\]/).pop();
      var ret = new Deferred();
      var deferred;
      var patch = this[name];
      if (patch) {
        var preference = this.getPreferences(patch.name) || {};
        if (preference.disabled) {
          this.setPreferences(patch.name, MochiKit.Base.update(preference, {
            disabled : false
          }));
          deferred = this.loadAndRegister(patch.fileEntry, patch.metadata);
        } else {
          return succeed(true);
        }
      } else {
        deferred = this.install(url, true);
      }
      deferred.addCallback(function (patch) {
        ret.callback(!!patch);
      });
      return ret;
    };

    Patches.require('https://raw.github.com/YungSang/patches-for-taberareloo/master/utils/util.wedata.tbrl.js');

    Menus._register({
      type     : 'separator',
      contexts : ['all']
    });
    Menus._register({
      title    : 'iview',
      contexts : ['all'],
      onclick: function (info, tab) {
        chrome.windows.create({
          url : IVIEW_URL
        }, function (win) {
        });
      }
    });
    Menus.create();

    TBRL.setRequestHandler('loadSiteInfo', function (req, sender, func) {
      settings = req.settings;
      settings.debug && console.info(req);
      var database = new Wedata.Database('iview-for-taberareloo', req.url, settings.debug);
      database.get(settings.refresh).addCallback(function (data) {
        func(JSON.parse(data));
      });
    });

    var WebRequest = {
      headers : null,

      addBeforeSendHeader : function (headers) {
        settings.debug && console.info('addBeforeSendHeader', headers);
        headers.forEach(function (header) {
          header.listener = function (details) {
            settings.debug && console.info('onBeforeSendHeaders', header);
            var requestHeaders = details.requestHeaders;
            requestHeaders = WebRequest.setHTTPHeader(requestHeaders, header.name, header.value);
            return {requestHeaders: requestHeaders};
          };
          chrome.webRequest.onBeforeSendHeaders.addListener(
            header.listener,
            { urls: [header.filter] },
            [ "blocking", "requestHeaders" ]
          );
        });
        this.headers = headers;
      },

      removeBeforeSendHeader : function () {
        settings.debug && console.info('removeBeforeSendHeader', this.headers);
        if (!this.headers) {
          return;
        }
        this.headers.forEach(function (header) {
          chrome.webRequest.onBeforeSendHeaders.removeListener(
            header.listener,
            { urls: [header.filter] },
            [ "blocking", "requestHeaders" ]
          );
        });
        this.headers = null;
      },

      setHTTPHeader : function (headers, name, value) {
        var overwite = false;
        for (var i = 0; i < headers.length; i++) {
          if (headers[i].name.toLowerCase() === name.toLowerCase()) {
            headers[i].value = value;
            overwite = true;
          }
        }
        return overwite ? headers : headers.concat({ name: name, value: value });
      }
    };

    TBRL.setRequestHandler('addBeforeSendHeader', function (req, sender, func) {
      WebRequest.addBeforeSendHeader(req.headers);
      func();
    });
    TBRL.setRequestHandler('removeBeforeSendHeader', function (req, sender, func) {
      WebRequest.removeBeforeSendHeader();
      func();
    });
    return;
  }

  settings = querystring.parse(url.parse(location.href).query);
  settings.debug && console.info('settings', settings);
// debug=1, print console messages to debug
// refresh=1, force to download remote SITEINFOs and refresh the cache
// siteinfo=SITEINFO_URL, use this URL to download remote SITEINFOs

  var requestopts = {
//    charset: 'utf-8'
    responseType: 'document'
  };

  var requestBroker = {
    queue: [],
    init: function () {
      this.queue = [];
      var self = this;
      var brokertimer = window.setInterval(function () {
        if (iviewLoader.shouldPrefetch()) {
          var args = self.queue.shift();

          if (args) {
            var u = args[0];
            var opts = args[1];
            var f = args[2];
            request(u, opts).addCallback(f).addErrback(function (e) {
              console.error(e);
            });
          }
        }
      }, 500);
      return brokertimer;
    },
    add: function (u, opts, callback) {
      this.queue.push(arguments);
    },
    clear: function () {
      this.queue.length = 0;
    }
  };

  var iviewLoader = {
    siteinfo: null,

    PREFETCHSIZE: 20,

    images: [],
    currentPage: null,
    eventListener: null,
    lastPageDoc: null,
    lastPageURI: null,
    run: function (siteinfo, eventListener) {
      var self = this;

      this.siteinfo = siteinfo;
      this.currentPage = null;
      this.lastPageURI = null;
      this.lastPageDoc = null;
      this.images = [];

      if (this.siteinfo.options && this.siteinfo.options.needReferer) {
        chrome.runtime.sendMessage(TBRL.id, {
          request : "addBeforeSendHeader",
          headers : [{
            filter : this.siteinfo.options.needReferer,
            name   : 'Referer',
            value  : this.siteinfo.options.refererUrl || this.siteinfo.url
          }]
        }, function () {
          self.requestNextPage();
          self.eventListener = eventListener;
        });

        window.addEventListener('beforeunload', this.removeFilter, false);
      }
      else {
        this.requestNextPage();
        this.eventListener = eventListener;
      }
    },
    stop: function () {
      if (this.siteinfo.options && this.siteinfo.options.needReferer) {
        window.removeEventListener('beforeunload', this.removeFilter, false);
        this.removeFilter();
      }

      this.siteinfo      = null;
      this.images.length = 0;
      this.currentPage   = null;
      this.lastPageDoc   = null;
      this.lastPageURI   = null;

      this.requestingNextPage         = false;
      this.largestRequestedImageIndex = -1;
    },
    removeFilter: function () {
      chrome.runtime.sendMessage(TBRL.id, {
        request : "removeBeforeSendHeader"
      }, function () {});
    },

    requestingNextPage: false,
    largestRequestedImageIndex: -1,
    shouldPrefetch: function () {
      var b = (this.images.length - this.largestRequestedImageIndex <= this.PREFETCHSIZE);
      return b;
    },
    getAt: function (n) {
      if (n > this.largestRequestedImageIndex) {
        this.largestRequestedImageIndex = n;
      }
      if (this.shouldPrefetch()) {
        if (!this.requestingNextPage) {
          this.requestNextPage();
        }
      }

      return this.images[n];
    },
    requestNextPage: function () {
      if (this.currentPage) {
        if (!this.siteinfo.nextLink) {
          return;
        }
        var link = [].concat($X(this.siteinfo.nextLink, this.lastPageDoc)).shift();
        var nextLink = valueOfNode(link);
        if (!nextLink) {
          return;
        }
        this.currentPage = url.resolve(this.lastPageURI, nextLink);
      } else {
        this.currentPage = this.siteinfo.url;
      }

      var nextPage = this.currentPage;

      this.requestingNextPage = true;
      var self = this;
      requestBroker.add(nextPage, requestopts, function (res) {
        self.lastPageURI = nextPage;
        self.lastPageDoc = res.response;
        self.requestingNextPage = false;
        self.parseResponse(self.lastPageDoc, self.siteinfo, self.lastPageURI, {});
      });
    },
    onSubrequestLoad: function (res) {
      var siteinfo = this.siteinfo.subRequest;
      var doc = res.response;
      this.parseResponse(doc, siteinfo, doc.baseURI, {permalink: doc.URL});
    },
    parseResponse: function (doc, siteinfo, baseURI, hashTemplate) {
      settings.debug && console.group('parseResponse');
      settings.debug && console.debug(siteinfo, doc);
      var paragraphes = [].concat($X(siteinfo.paragraph, doc));
      settings.debug && console.debug(paragraphes);
      if (paragraphes.length === 0) {
        console.error('Something wrong with siteinfo.paragraph');
        throw new TypeError('Something wrong with siteinfo.paragraph');
      }
      var self = this;
      paragraphes.map(function (paragraph, index) {
        var img = {};
        if (siteinfo.subRequest && siteinfo.subRequest.paragraph) {
          img = self.parseParagraph(paragraph, siteinfo, baseURI);

          var subpage = img.permalink;

          requestBroker.add(subpage, requestopts, function (res) {
            self.onSubrequestLoad.apply(self, arguments);
          });

        } else {
          if (siteinfo.subParagraph && siteinfo.subParagraph.paragraph) {
            var d = self.parseParagraph(paragraph, siteinfo, baseURI);

            if (siteinfo.subParagraph.cdata) {
              try {
                var cdata = [].concat($X(siteinfo.subParagraph.cdata, paragraph)).shift().textContent;
                cdata = '<html><body>' + cdata + '</body></html>';
                paragraph = createHTML(cdata);
              } catch (e) {
                console.error(e);
              }
            }

            var subparagraphes = $X(siteinfo.subParagraph.paragraph, paragraph);
            subparagraphes.map(function (subparagraph) {
              img = self.parseParagraph(subparagraph, siteinfo.subParagraph, baseURI);
              img = MochiKit.Base.update({}, hashTemplate, d, img);
              self.addToImageList(img);
            });
          } else {
            img = self.parseParagraph(paragraph, siteinfo, baseURI);
            img = MochiKit.Base.update({}, hashTemplate, img);
            self.addToImageList(img);
          }
        }
      });
      settings.debug && console.groupEnd();

      var obs = this.eventListener;
      obs && obs.onPageLoad.apply(obs);
    },
    addToImageList: function (img) {
      if (img.imageSource && img.permalink) {
        (new window.Image()).src = img.imageSource;
        this.images.push(img);
      }
    },
    parseParagraph: function (paragraph, siteinfo, baseURI) {
      settings.debug && console.group('parseParagraph');
      var image = {
        src: function () {
          return this.imageSourceForReblog || this.imageSource;
        }
      };

      for (var k in siteinfo) {
        var xpath = siteinfo[k];

        if (k.match(/^url|paragraph|nextLink|cdata|options$/)) {
          continue;
        }

        if (!xpath || typeof xpath === 'object') {
          continue;
        }

        var v = null;
        var rs = $X(xpath, paragraph);
        settings.debug && console.debug(k, rs);
        if (typeof rs === 'string') {
          v = rs;
          if (k === 'caption') {
            v =  v.trim();
          } else {
            v = url.resolve(baseURI, v);
          }
        } else {
          var node = [].concat(rs).shift();
          if (!node) {
            console.warn('Something wrong with siteinfo.' + k);
          }
          else if (k === 'caption') {
            if (typeof node === 'object') {
              v =  node.textContent.trim();
            }
            else {
              v = valueOfNode(node);
            }
          } else {
            v = valueOfNode(node);
            v = url.resolve(baseURI, v);
          }
        }

        settings.debug && console.debug(k, v);
        image[k] = v;
      }
      settings.debug && console.groupEnd();
      return image;
    }
  };

  var iview = {
    position: 0,
    doc: null,
    iviewSiteinfoURL: settings.siteinfo || SITEINFO_URL,
    siteinfo: null,
    init: function (doc) {
      this.doc = doc;

      this.doc.getElementById('no_patch_script').style.display = 'none';

      this.siteinfo = null;
      this.position = 0;

      doc.addEventListener("onIviewFxNext", function () {
        //iviewLoader.onImageSourceSelected.apply(iview, arguments);
      }, false);
      doc.addEventListener("onJSONPLoad", function () {
        iview.onImageSourceSelected.apply(iview, arguments);
      }, false);

      doc.addEventListener("keypress", function (ev) {
        var c = String.fromCharCode(ev.charCode).toLowerCase();

        if (ev.currentTarget !== doc) {
          return;
        }

        if (ev.ctrlKey || ev.altKey || ev.shiftKey || ev.metaKey) {
          return;
        }

        if (c === 't') {
          iview.share();
        } else if (c === 'j') {
          iview.goRelative(1);
        } else if (c === 'k') {
          iview.goRelative(-1);
        } else if (c === 'b') {
          iview.goHome();
        } else if (c === 'o') {
          iview.openOriginal();
//        } else if (c === 'p') {
//          iview.launchPicLens();
        }

      }, false);
    },
    share: function () {
      var i = iviewLoader.getAt(this.position);

      var title = i.caption || i.permalink;

      var ctx = {
        document : document,
        window   : window,
        title    : title,
        href     : i.permalink,
        link     : {
          href : i.permalink
        },
        onLink   : true,
        onImage  : true,
        target   : $N('img', {
          src: i.src()
        })
      };

      var ext;
      if (iviewLoader.siteinfo.options && iviewLoader.siteinfo.options.needReferer) {
        ext = Extractors['Photo - Upload from Cache'];
      }
      else {
        ext = Extractors['ReBlog - Tumblr link'];
      }

      (ext.check(ctx) ? TBRL.extract(ctx, ext) : succeed({
        type    : 'photo',
        item    : title,
        itemUrl : i.src()
      })).addCallback(function (ps) {
        chrome.runtime.sendMessage(TBRL.id, {
          request : 'share',
          show    : false,
          content : checkHttps(update({
            page    : ctx.title,
            pageUrl : ctx.href
          }, ps))
        }, function () { });
      });
    },
    showRebloggingBox: function (i) {
      var r = this.doc.getElementById('reblogging');
      if (i.reblogging) {
        var img = this.doc.getElementById('imageElement');

        var margin = 10;
        r.style.display = 'block';
        r.style.top  = (img.offsetHeight - img.height + r.clientHeight + margin) + "px";
        r.style.left = img.offsetLeft + margin + "px";
        r.style.opacity = 0.75;

      } else {
        var n = 0;
        var timerid = window.setInterval(function () {
          if (n++ < 10) {
            r.style.opacity = 1 - (0.1 * n);
          } else {
            window.clearInterval(timerid);
            r.style.opacity = 1;
            r.style.display = 'none';
          }
        }, 50);
      }
    },
    goRelative: function (diff) {
      if (!iviewLoader.siteinfo) {
        return;
      }
      var imageInfo = iviewLoader.getAt(this.position + diff);
      if (imageInfo) {
        var i = iviewLoader.getAt(this.position);
        if (i.reblogging) {
          var r = this.doc.getElementById('reblogging');
          r.style.display = 'none';
        }

        this.position += diff;

        this.show();
      }
    },
    goHome: function () {
      requestBroker.clear();
      iviewLoader.stop();
      this.position = 0;
      this.doc.getElementById('imageno').innerHTML = '';
      this.doc.getElementById('imagebox').style.display = 'none';
      this.doc.getElementById('footer').style.display = 'none';
      this.doc.getElementById('imagesources').style.display = 'block';
    },
    openOriginal: function () {
      var i = iviewLoader.getAt(this.position);
      if (!i || !i.permalink) {
        return;
      }
      window.open(i.permalink, '_iview_for_taberareloo');
    },
    constructTree: function (flatSiteinfo) {
      var siteinfo = {};

      for (var k in flatSiteinfo) {
        var pathes = k.split(/\./);
        var leaf = pathes.pop();
        var hash = pathes.reduce(function (stash, name) {
          return (stash[name] || (stash[name] = {}));
        }, siteinfo);
        hash[leaf] = flatSiteinfo[k];
      }
      return siteinfo;
    },

    pageShowing: -1,
    show: function () {
      if (this.pageShowing === this.position) {
        return;
      }

      var imageInfo = iviewLoader.getAt(this.position);
      if (!imageInfo) {
        return;
      }

      this.doc.getElementById('imageno').innerHTML = (this.position + 1) + "/" + iviewLoader.images.length;
      this.showRebloggingBox(imageInfo);

      //this.removeAllChildren();
      var box = this.doc.getElementById('imagebox');
      box.style.display = 'block';

      // we need to assign null value once
      // to avoid that old image is shown until new image is loaded.
      var img = this.doc.getElementById('imageElement');
      img.setAttribute('src', null);

      window.setTimeout(function () {
        img.setAttribute('src', imageInfo.imageSource);
      }, 20);

      var a = this.doc.getElementById('caption');
      a.setAttribute('href', imageInfo.permalink);
      a.innerHTML = imageInfo.caption;
    },
    removeAllChildren: function (e) {
      while (e.firstChild) {
        e.removeChild(e.firstChild);
      }
    },
    onImageSourceSelected: function (ev) {
  /*
      this.glasscaseDiv.style.opacity = 1;
      this.glasscaseDiv.style.position = 'fixed';
      this.glasscaseDiv.style.top = 0;
      this.glasscaseDiv.style.bottom = 0;
  */

      this.doc.getElementById('footer').style.display = 'block';

      var key = (ev.detail);
      var siteinfo = this.constructTree(this.siteinfo[key].data);

      this.doc.getElementById('sourcename').innerHTML =
        '<a href="' + siteinfo.url + '">' + this.siteinfo[key].name + '</a>';

      //this.removeAllChildren();
      //
      this.doc.getElementById('imagesources').style.display = 'none';

      iviewLoader.run(siteinfo, this);
    },
    launchPicLens : function () {
      var items = [];
      iviewLoader.images.forEach(function (photo) {
        var imegeUri = photo.src();
        items.push('<item>' +
            '<title>' + photo.caption + '</title>' +
            '<link>' + photo.permalink + '</link>' +
            '<media:thumbnail url="' + imegeUri + '" />' +
            '<media:content url="' + imegeUri + '" />' +
          '</item>'
        );
      });

      var file = getTempDir('photos.rss');
      putContents(file, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss"><channel>' +
          items.join('') +
         '</channel></rss>');

      this.doc.location = 'javascript:piclens = new PicLensContext();piclens.launch("' + createURI(file).asciiSpec + '", "", "")';
    },
    /*
    setStyle: function (doc) {
      var css = doc.createElement('style');
      css.innerHTML =
        ' a {' +
        '   background-color: black !important;' +
        '   color: white !important;' +
        '   font-size: small !important;' +
        ' }' ;

      doc.body.appendChild(css);
    },
    */
    showLoading: function (doc, show) {
      if (show) {
        var d = doc.createElement("div");

        d.style.position = "absolute";
        d.style.fontSize = "30px";
        d.style.background = "black";
        d.style.color = "white";
        d.style.MozBorderRadius = "0.2em";
        d.style.padding = "0.2em";
        d.style.opacity = 0.85;
        d.style.marginLeft = "auto";
        d.style.marginRight = "auto";
        d.style.margin =   "0px auto";
        d.style.right = d.style.top = "0.2em";
        d.style.textAlign = "center";
        d.innerHTML = "Loading Image Sources...";

        doc.body.appendChild(d);

        this.loadingDiv = d;
      } else {
        this.loadingDiv.parentNode.removeChild(this.loadingDiv);
        this.loadingDiv = null;
      }
    },
    glasscaseDiv: null,
    glasscase: function () {
      var doc = this.doc;
      var outerbox = this.outerbox = doc.createElement("div");

      outerbox.style.position = "absolute";
      outerbox.style.left = 0;
      outerbox.style.top = 0;
      outerbox.style.right = 0;
      outerbox.style.height = 0;

      var d = this.innerbox = doc.createElement("div");

      d.style.left = 0;
      d.style.right = 0;

      //d.style.position = "absolute";
      d.style.fontSize = "30px";
      d.style.background = "black";
      d.style.color = "white";
      //d.style.MozBorderRadius = "0.2em";
      d.style.padding = "0.2em";
      d.style.opacity = 0.95;
      d.style.marginLeft = "auto";
      d.style.marginRight = "auto";
      d.style.margin =   "0px auto";
      //d.style.right = d.style.top = "0";
      d.style.zIndex = 0x7ffffff;

      outerbox.appendChild(d);
      doc.body.appendChild(outerbox);

      this.glasscaseDiv = d;
      return d;
    },

    onPageLoad: function () {
      this.show();
    },
    loadJson: function () {
      var self = this;
      //this.setStyle(this.doc);
      this.showLoading(this.doc, true);

      chrome.runtime.sendMessage(TBRL.id, {
        request  : "loadSiteInfo",
        url      : this.iviewSiteinfoURL,
        settings : settings
      }, function (json) {
        self.siteinfo = json;

        self.showLoading(self.doc, false);
        //var glasscase = self.glasscase();

        //
        // MochiKit.keys not found in command script scope.
        //
        self.doc.getElementById('imagesources').style.display = 'block';
        var ul = self.doc.getElementById('imagesourcelist');

        var li = [];
        for (var k in json) {
          var definitions = json[k];

          // I dont know why but last one is a function not siteinfo.
          // need to check it.
          if (!definitions.data) {
            continue;
          }

          // not supported yet.
          //if ( definitions.data['subRequest.paragraph'] ) {
          //  continue;
          //}

          //if ( definitions.data.paragraph.match(/x:/) ) {
          //  continue;
          //}

          var jscode = "javascript:void((function(){" +
            "e=new CustomEvent('onJSONPLoad',{detail:" + k + "});" +
            "document.dispatchEvent(e);" +
          "})());";

          var link = '<a href="' + jscode + '">' + definitions.name + '</a>';
          if (definitions.data.options && definitions.data.options.NSFW) {
            li.push('<li class="nsfw">' + link + '</li>');
          }
          else {
            li.push('<li>' + link + '</li>');
          }
        }
        ul.innerHTML = li.join("\n");
      });
    }
  };

  var brokerTimer = requestBroker.init();
  document.addEventListener('unload', function () {
    window.clearInterval(brokerTimer);
  }, false);
  iview.init(document);
  iview.loadJson();

  function $X(exp, context) {
    if (!context) {
      context = document;
    }
    var _document  = context.ownerDocument || context,
    documentElement = _document.documentElement,
    defaultPrefix = null;
/*
    isXHTML = documentElement.tagName !== 'HTML' && _document.createElement('p').tagName === 'p',
    if (isXHTML) {
      defaultPrefix = '__default__';
      exp = addDefaultPrefix(exp, defaultPrefix);
    }
*/
    function resolver(prefix) {
      return context.lookupNamespaceURI(prefix === defaultPrefix ? null : prefix) ||
           documentElement.namespaceURI || '';
    }
    function value(node) {
      if (!node) {
        return;
      }

      switch (node.nodeType) {
      case Node.ELEMENT_NODE:
        return node;
      case Node.ATTRIBUTE_NODE:
      case Node.TEXT_NODE:
        return node.textContent;
      }
    }
    settings.debug && console.groupCollapsed('$X');
    settings.debug && console.debug(exp);
    var ret;
    var result = _document.evaluate(exp, context, resolver, XPathResult.ANY_TYPE, null);
    switch (result.resultType) {
    case XPathResult.STRING_TYPE:
      ret = result.stringValue;
      break;
    case XPathResult.NUMBER_TYPE:
      ret = result.numberValue;
      break;
    case XPathResult.BOOLEAN_TYPE:
      ret = result.booleanValue;
      break;
    case XPathResult.UNORDERED_NODE_ITERATOR_TYPE:
      // not ensure the order.
      ret = [];
      var i = null;
      while ((i = result.iterateNext())) {
        ret.push(value(i));
      }
      break;
    }
    settings.debug && console.debug(ret);
    settings.debug && console.groupEnd();
    return ret;
  }

  function valueOfNode(node) {
    if (!node) {
      return node;
    }
    if (typeof node === 'string') {
      return node;
    }
    if (node.nodeType === node.ELEMENT_NODE) {
      if (node.tagName.match(/^(a|link)$/i)) {
        return node.getAttribute('href');
      } else if (node.tagName.match(/img/i)) {
        return node.getAttribute('src');
      } else {
        return node.textContent.trim();
      }
    } else if (node.nodeType === node.ATTRIBUTE_NODE) {
      return node.nodeValue;
    } else if (node.nodeType === node.TEXT_NODE) {
      return node.nodeValue;
    }
  }

})();
