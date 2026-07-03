document.addEventListener('DOMContentLoaded', () => {
  const tabSingle = document.getElementById('tabSingle');
  const tabBatch = document.getElementById('tabBatch');
  const panelSingle = document.getElementById('panelSingle');
  const panelBatch = document.getElementById('panelBatch');

  // Single elements
  const singleInput = document.getElementById('singleInput');
  const extractSingleBtn = document.getElementById('extractSingleBtn');
  const singlePreview = document.getElementById('singlePreview');
  const previewAvatar = document.getElementById('previewAvatar');
  const previewAuthor = document.getElementById('previewAuthor');
  const previewHandle = document.getElementById('previewHandle');
  const previewText = document.getElementById('previewText');
  const previewVideo = document.getElementById('previewVideo');
  const downloadSingleBtn = document.getElementById('downloadSingleBtn');

  // Batch elements
  const batchLinksContainer = document.getElementById('batchLinksContainer');
  const addLinkBtn = document.getElementById('addLinkBtn');
  const downloadZipBtn = document.getElementById('downloadZipBtn');

  // Toast
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');

  let currentSingleVideoUrl = null;
  let currentSingleTweetId = null;

  function showToast(msg) {
    toastMsg.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  // Tab switching
  tabSingle.addEventListener('click', () => {
    tabSingle.classList.add('active');
    tabBatch.classList.remove('active');
    panelSingle.style.display = 'block';
    panelBatch.style.display = 'none';
  });

  tabBatch.addEventListener('click', () => {
    tabBatch.classList.add('active');
    tabSingle.classList.remove('active');
    panelBatch.style.display = 'block';
    panelSingle.style.display = 'none';
  });

  // Single Mode Extraction
  extractSingleBtn.addEventListener('click', async () => {
    const url = singleInput.value.trim();
    if (!url) {
      showToast('⚠️ Please paste a Twitter / X link first.');
      return;
    }

    extractSingleBtn.disabled = true;
    extractSingleBtn.innerHTML = '<span>⏳ Extracting Media...</span>';

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [url] })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Extraction failed.');

      const result = data.results[0];
      if (!result.success) {
        throw new Error(result.error);
      }

      // Populate UI
      currentSingleVideoUrl = result.videoUrl;
      currentSingleTweetId = result.tweetId;

      previewAvatar.src = result.author.avatar || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
      previewAuthor.textContent = result.author.name;
      previewHandle.textContent = `@${result.author.screen_name}`;
      previewText.textContent = result.text;

      previewVideo.src = result.videoUrl;
      singlePreview.style.display = 'block';

      showToast('✨ Video extracted successfully!');
    } catch (err) {
      showToast(`❌ Error: ${err.message}`);
    } finally {
      extractSingleBtn.disabled = false;
      extractSingleBtn.innerHTML = '<span>⚡ Extract Video</span>';
    }
  });

  downloadSingleBtn.addEventListener('click', () => {
    if (!currentSingleVideoUrl) return;
    showToast('🚀 Downloading High Quality MP4...');
    const filename = `X_Video_${currentSingleTweetId || Date.now()}.mp4`;
    const proxyUrl = `/api/download-single?url=${encodeURIComponent(currentSingleVideoUrl)}&filename=${encodeURIComponent(filename)}`;
    
    const a = document.createElement('a');
    a.href = proxyUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // Batch Mode Dynamic Links
  addLinkBtn.addEventListener('click', () => {
    const div = document.createElement('div');
    div.className = 'batch-link-item';
    div.innerHTML = `
      <input type="text" class="text-input batch-url-input" placeholder="https://x.com/user/status/3333333333333333333">
      <button class="btn-remove remove-link-btn" title="Remove link">✕</button>
    `;
    batchLinksContainer.appendChild(div);
  });

  batchLinksContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-link-btn') || e.target.closest('.remove-link-btn')) {
      const item = e.target.closest('.batch-link-item');
      if (batchLinksContainer.children.length > 1) {
        item.remove();
      } else {
        item.querySelector('input').value = '';
      }
    }
  });

  // Batch Zip Export
  const batchProgressCard = document.getElementById('batchProgressCard');
  const batchProgressTitle = document.getElementById('batchProgressTitle');
  const batchProgressPercent = document.getElementById('batchProgressPercent');
  const batchProgressBar = document.getElementById('batchProgressBar');
  const batchProgressLog = document.getElementById('batchProgressLog');

  downloadZipBtn.addEventListener('click', async () => {
    const inputs = document.querySelectorAll('.batch-url-input');
    const urls = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);

    if (urls.length === 0) {
      showToast('⚠️ Please add at least one Twitter / X video link.');
      return;
    }

    downloadZipBtn.disabled = true;
    downloadZipBtn.innerHTML = '<span>⏳ Processing Batch Request...</span>';
    batchProgressCard.style.display = 'block';
    batchProgressTitle.textContent = '⏳ Step 1/2: Extracting Media Links...';
    batchProgressPercent.textContent = '20%';
    batchProgressBar.style.width = '20%';
    batchProgressLog.textContent = `Querying Twitter/X servers for ${urls.length} link(s)...`;

    try {
      showToast(`⚡ Extracting media for ${urls.length} links...`);

      const extractRes = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      });

      const extractData = await extractRes.json();
      if (!extractRes.ok) throw new Error(extractData.error || 'Failed to analyze links.');

      const items = [];
      let idx = 1;
      for (const res of extractData.results) {
        if (res.success && res.videoUrl) {
          items.push({
            url: res.videoUrl,
            filename: `Tweet_${res.tweetId || idx}.mp4`
          });
          idx++;
        }
      }

      if (items.length === 0) {
        throw new Error('Could not find downloadable videos in the provided links.');
      }

      batchProgressTitle.textContent = `⏳ Step 2/2: Downloading & Compressing ${items.length} Video(s)...`;
      batchProgressPercent.textContent = '50%';
      batchProgressBar.style.width = '50%';
      batchProgressLog.textContent = `Server is downloading and building ZIP archive for ${items.length} videos... Check backend logs!`;

      showToast(`📦 Compressing ${items.length} videos into ZIP archive...`);
      downloadZipBtn.innerHTML = '<span>⏳ Building ZIP & Downloading...</span>';

      // Trigger POST download for ZIP file via fetch blob
      const zipRes = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });

      if (!zipRes.ok) throw new Error('Failed to generate ZIP file.');

      batchProgressPercent.textContent = '90%';
      batchProgressBar.style.width = '90%';
      batchProgressLog.textContent = 'Transferring completed archive to your browser...';

      const blob = await zipRes.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `XPulse_Twitter_Videos_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);

      batchProgressTitle.textContent = '🎉 Batch Complete!';
      batchProgressPercent.textContent = '100%';
      batchProgressBar.style.width = '100%';
      batchProgressLog.textContent = `Successfully downloaded ZIP file containing ${items.length} video(s)!`;

      showToast('🎉 ZIP Archive downloaded successfully!');
    } catch (err) {
      batchProgressTitle.textContent = '❌ Error Encountered';
      batchProgressPercent.textContent = 'Failed';
      batchProgressBar.style.background = '#EF4444';
      batchProgressLog.textContent = err.message;
      showToast(`❌ Error: ${err.message}`);
    } finally {
      downloadZipBtn.disabled = false;
      downloadZipBtn.innerHTML = '<span>📦 Extract All & Download ZIP Archive</span>';
    }
  });
});
