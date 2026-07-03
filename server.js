const express = require('express');
const cors = require('cors');
const axios = require('axios');
const archiver = require('archiver');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to extract Tweet ID from various X / Twitter URL formats
function extractTweetId(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return null;
  const trimmed = inputUrl.trim();
  const match = trimmed.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
  if (match) {
    return match[1];
  }
  // If user pasted just numeric ID
  if (/^\d{10,22}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

// Multi-endpoint Twitter/X media extractor
async function extractTweetMedia(tweetId) {
  const errors = [];

  // 1. Try VxTwitter API
  try {
    const vxRes = await axios.get(`https://api.vxtwitter.com/Twitter/status/${tweetId}`, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (vxRes.data && vxRes.data.media_extended) {
      const videos = vxRes.data.media_extended
        .filter(m => m.type === 'video' || m.type === 'gif')
        .map(m => ({
          url: m.url,
          thumbnail: m.thumbnail_url || m.url,
          duration_millis: m.duration_millis || 0
        }));

      if (videos.length > 0) {
        return {
          id: tweetId,
          text: vxRes.data.text || '',
          author: {
            name: vxRes.data.user_name || 'Twitter User',
            screen_name: vxRes.data.user_screen_name || 'user',
            avatar: vxRes.data.user_profile_image_url || null
          },
          videos,
          source: 'vxtwitter'
        };
      }
    }
  } catch (err) {
    errors.push(`VxTwitter error: ${err.message}`);
  }

  // 2. Try FxTwitter API
  try {
    const fxRes = await axios.get(`https://api.fxtwitter.com/Twitter/status/${tweetId}`, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (fxRes.data && fxRes.data.tweet && fxRes.data.tweet.media && fxRes.data.tweet.media.videos) {
      const videos = fxRes.data.tweet.media.videos.map(v => ({
        url: v.url,
        thumbnail: v.thumbnail_url || null,
        format: v.format || 'video/mp4'
      }));

      if (videos.length > 0) {
        return {
          id: tweetId,
          text: fxRes.data.tweet.text || '',
          author: {
            name: (fxRes.data.tweet.author && fxRes.data.tweet.author.name) || 'Twitter User',
            screen_name: (fxRes.data.tweet.author && fxRes.data.tweet.author.screen_name) || 'user',
            avatar: (fxRes.data.tweet.author && fxRes.data.tweet.author.avatar_url) || null
          },
          videos,
          source: 'fxtwitter'
        };
      }
    }
  } catch (err) {
    errors.push(`FxTwitter error: ${err.message}`);
  }

  // 3. Try Twitter Syndication Endpoint
  try {
    const synRes = await axios.get(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=c`, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (synRes.data && synRes.data.video) {
      const variants = synRes.data.video.variants || [];
      const mp4s = variants
        .filter(v => v.src && v.src.includes('.mp4'))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      if (mp4s.length > 0) {
        return {
          id: tweetId,
          text: synRes.data.text || '',
          author: {
            name: (synRes.data.user && synRes.data.user.name) || 'Twitter User',
            screen_name: (synRes.data.user && synRes.data.user.screen_name) || 'user',
            avatar: (synRes.data.user && synRes.data.user.profile_image_url_https) || null
          },
          videos: [{ url: mp4s[0].src, thumbnail: synRes.data.video.poster || null }],
          source: 'syndication'
        };
      }
    }
  } catch (err) {
    errors.push(`Syndication error: ${err.message}`);
  }

  return null;
}

// API Endpoint: Extract single or multiple links
app.post('/api/extract', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of Twitter/X links.' });
    }

    console.log(`\n[Extract API] Starting extraction for ${urls.length} link(s)...`);
    const results = [];
    for (const link of urls) {
      const tweetId = extractTweetId(link);
      if (!tweetId) {
        console.warn(`[Extract API] Invalid link format: ${link}`);
        results.push({ link, success: false, error: 'Invalid X / Twitter link format.' });
        continue;
      }

      console.log(`[Extract API] Querying endpoints for Tweet ID: ${tweetId}...`);
      const mediaData = await extractTweetMedia(tweetId);
      if (mediaData && mediaData.videos && mediaData.videos.length > 0) {
        console.log(`[Extract API] -> Success! Found ${mediaData.videos.length} video variant(s) via [${mediaData.source}].`);
        results.push({
          link,
          success: true,
          tweetId,
          author: mediaData.author,
          text: mediaData.text,
          videoUrl: mediaData.videos[0].url,
          thumbnail: mediaData.videos[0].thumbnail,
          allVideos: mediaData.videos
        });
      } else {
        console.warn(`[Extract API] -> Failed to find video media for Tweet ID: ${tweetId}`);
        results.push({
          link,
          success: false,
          tweetId,
          error: 'No video found in this tweet or tweet is private/deleted.'
        });
      }
    }

    console.log(`[Extract API] Finished processing ${urls.length} link(s). Sending response to client.`);
    return res.json({ results });
  } catch (error) {
    console.error('[Extract API Error]:', error);
    return res.status(500).json({ error: 'Server error processing extraction request.' });
  }
});

// API Endpoint: Proxy single video download
app.get('/api/download-single', async (req, res) => {
  const { url, filename } = req.query;
  if (!url) {
    return res.status(400).send('No video stream URL provided.');
  }

  const cleanName = filename || `X_Video_${Date.now()}.mp4`;
  console.log(`\n[Single Download] Streaming video: ${cleanName}`);

  try {
    const response = await axios({
      method: 'get',
      url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': '*/*'
      },
      timeout: 30000
    });

    res.setHeader('Content-Disposition', `attachment; filename="${cleanName}"`);
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.pipe(res);
  } catch (error) {
    console.error('[Single Download Error]:', error.message);
    res.status(500).send('Failed to download video stream.');
  }
});

// API Endpoint: Package multiple videos into a ZIP archive and stream to browser
app.post('/api/download-zip', async (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No video items provided for archiving.' });
  }

  const archiveName = `Twitter_Videos_Batch_${Date.now()}.zip`;
  console.log(`\n======================================================`);
  console.log(`[ZIP Engine] Starting batch ZIP archive: "${archiveName}"`);
  console.log(`[ZIP Engine] Total videos to compress: ${items.length}`);
  console.log(`======================================================`);

  res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);
  res.setHeader('Content-Type', 'application/zip');

  const archive = archiver('zip', {
    zlib: { level: 5 } // Balanced compression speed
  });

  archive.on('error', (err) => {
    console.error('[ZIP Engine Error] Archiver stream error:', err.message);
    if (!res.headersSent) {
      res.status(500).send({ error: err.message });
    }
  });

  archive.pipe(res);

  try {
    let index = 1;
    for (const item of items) {
      if (!item.url) continue;
      const safeFilename = item.filename || `Tweet_Video_${index}.mp4`;
      console.log(`[ZIP Progress (${index}/${items.length})] Downloading remote video: ${safeFilename}...`);

      try {
        const vidRes = await axios({
          method: 'get',
          url: item.url,
          responseType: 'arraybuffer',
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': '*/*'
          },
          timeout: 45000
        });

        const sizeMB = (vidRes.data.byteLength / (1024 * 1024)).toFixed(2);
        console.log(`[ZIP Progress (${index}/${items.length})] Downloaded ${safeFilename} (${sizeMB} MB). Appending to zip...`);
        archive.append(vidRes.data, { name: safeFilename });
        index++;
      } catch (streamErr) {
        console.warn(`[ZIP Progress (${index}/${items.length})] Failed to download ${safeFilename}: ${streamErr.message}`);
        archive.append(`Failed to download: ${item.url}\nError: ${streamErr.message}`, { name: `ERROR_${safeFilename}.txt` });
        index++;
      }
    }

    console.log('[ZIP Engine] All video files appended. Finalizing ZIP archive...');
    await archive.finalize();
    console.log('[ZIP Engine] 🎉 ZIP Archive finalized and sent to client successfully!');
  } catch (err) {
    console.error('[ZIP Engine Fatal Error]:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`XPulse server running at http://localhost:${PORT}`);
});
