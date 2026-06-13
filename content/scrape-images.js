var MSG_TYPES = {
  SCRAPE_IMAGES: 'SCRAPE_IMAGES',
  START_PIN_JOB: 'START_PIN_JOB',
};

var MIN_IMAGE_WIDTH = 200;
var MIN_IMAGE_HEIGHT = 200;

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === MSG_TYPES.SCRAPE_IMAGES) {
    var images = scrapeImages();
    sendResponse({ images: images });
  }
});

function scrapeImages() {
  var results = [];
  var seen = {};
  var allImgs = [].slice.call(document.querySelectorAll('img'));

  for (var i = 0; i < allImgs.length; i++) {
    var img = allImgs[i];
    var src = getSrc(img);
    if (!src || seen[src]) continue;
    seen[src] = true;

    var w = img.naturalWidth || img.width || 0;
    var h = img.naturalHeight || img.height || 0;

    if (w >= MIN_IMAGE_WIDTH && h >= MIN_IMAGE_HEIGHT) {
      results.push({
        src: src,
        width: w,
        height: h,
        alt: img.alt || '',
      });
    }
  }

  var bgImages = findBackgroundImages();
  for (var j = 0; j < bgImages.length; j++) {
    if (!seen[bgImages[j].src]) {
      seen[bgImages[j].src] = true;
      results.push(bgImages[j]);
    }
  }

  var videoPosters = [].slice.call(document.querySelectorAll('video'));
  for (var k = 0; k < videoPosters.length; k++) {
    var video = videoPosters[k];
    // Try the video src directly first
    var videoSrc = video.src || video.currentSrc;
    if (videoSrc && !seen[videoSrc] && videoSrc.startsWith('http')) {
      seen[videoSrc] = true;
      results.push({ src: videoSrc, width: video.videoWidth || 0, height: video.videoHeight || 0, alt: 'video', isVideo: true });
    }
    // Also try the poster as an image
    var poster = video.poster;
    if (poster && !seen[poster]) {
      seen[poster] = true;
      results.push({ src: poster, width: 0, height: 0, alt: 'video poster' });
    }
  }

  var videoSources = [].slice.call(document.querySelectorAll('video source'));
  for (var m = 0; m < videoSources.length; m++) {
    var vsrc = videoSources[m].src;
    if (vsrc && !seen[vsrc]) {
      seen[vsrc] = true;
      results.push({ src: vsrc, width: 0, height: 0, alt: 'video', isVideo: true });
    }
  }

  results.sort(function (a, b) {
    return (b.width * b.height) - (a.width * a.height);
  });

  return results.slice(0, 50);
}

function getSrc(img) {
  var src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
  if (!src) return null;
  if (src.startsWith('//')) src = 'https:' + src;
  if (src.startsWith('data:image')) return src;
  if (!src.startsWith('http')) return null;
  return src;
}

function findBackgroundImages() {
  var results = [];
  var allElements = [].slice.call(document.querySelectorAll('*'));
  for (var i = 0; i < allElements.length; i++) {
    var style = window.getComputedStyle(allElements[i]);
    var bg = style.backgroundImage || style.background;
    if (bg && bg.indexOf('url(') !== -1) {
      var match = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (match && match[1] && match[1].startsWith('http')) {
        results.push({ src: match[1], width: 0, height: 0, alt: '' });
      }
    }
  }
  return results;
}