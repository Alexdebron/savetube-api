const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

class SaveTube {
  constructor() {
    this.key = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');
    this.formats = new Set(['144', '240', '360', '480', '720', '1080', 'mp3']);
    this.http = axios.create({
      timeout: 45000,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://ytshortdown.com',
        'User-Agent': 'Mozilla/5.0'
      },
      // Let us return a useful JSON error instead of throwing on 4xx/5xx.
      validateStatus: (status) => status >= 200 && status < 300
    });
  }

  extractId(value) {
    try {
      const input = String(value).trim();
      const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
      const host = url.hostname.replace(/^www\./i, '').toLowerCase();

      if (host === 'youtu.be') {
        return url.pathname.split('/').filter(Boolean)[0] || null;
      }

      if (!['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
        return null;
      }

      if (url.searchParams.get('v')) return url.searchParams.get('v');

      const parts = url.pathname.split('/').filter(Boolean);
      const markerIndex = parts.findIndex((part) => ['shorts', 'embed', 'v'].includes(part));
      return markerIndex >= 0 ? parts[markerIndex + 1] || null : null;
    } catch (_) {
      return null;
    }
  }

  async getCdn() {
    const response = await this.http.get('https://media.savetube.vip/api/random-cdn');
    const cdn = response.data && response.data.cdn;
    if (!cdn) throw new Error('SaveTube CDN was not returned');
    return cdn;
  }

  normalizeDownloadUrl(value) {
    if (typeof value !== 'string' || !value) return null;

    // SaveTube currently returns audio files under /file, but those URLs
    // redirect to the homepage. The same file is available under /media.
    try {
      const url = new URL(value);
      if (url.pathname.startsWith('/file/')) {
        url.pathname = url.pathname.replace(/^\/file\//, '/media/');
      }
      return url.toString();
    } catch (_) {
      return value;
    }
  }

  decrypt(encoded) {
    if (typeof encoded !== 'string' || !encoded) {
      throw new Error('Invalid encrypted info response');
    }

    const encrypted = Buffer.from(encoded.replace(/\s/g, ''), 'base64');
    if (encrypted.length <= 16) throw new Error('Encrypted response is too short');

    const iv = encrypted.subarray(0, 16);
    const decipher = crypto.createDecipheriv('aes-128-cbc', this.key, iv);
    const plain = Buffer.concat([
      decipher.update(encrypted.subarray(16)),
      decipher.final()
    ]);
    return JSON.parse(plain.toString('utf8'));
  }

  async download(inputUrl, requestedFormat = 'mp3') {
    const id = this.extractId(inputUrl);
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
      return { status: false, message: 'A valid YouTube URL is required.' };
    }

    // Accept common UI values such as 720p and MP3 as well.
    const format = String(requestedFormat || 'mp3').toLowerCase().replace(/p$/, '');
    if (!this.formats.has(format)) {
      return {
        status: false,
        message: 'Unsupported format.',
        formats: [...this.formats]
      };
    }

    try {
      const cdn = await this.getCdn();
      const originUrl = `https://www.youtube.com/watch?v=${id}`;

      // Current SaveTube API: response.data.data is the encrypted string.
      const infoResponse = await this.http.post(`https://${cdn}/v2/info`, {
        url: originUrl
      });
      const encrypted = infoResponse.data?.data;
      const info = this.decrypt(encrypted);

      if (!info.key) throw new Error('SaveTube did not return a conversion key');

      // Current API expects exactly downloadType, quality and key.
      const downloadResponse = await this.http.post(`https://${cdn}/download`, {
        downloadType: format === 'mp3' ? 'audio' : 'video',
        quality: format === 'mp3' ? '128' : format,
        key: info.key
      });

      const payload = downloadResponse.data;
      const downloadUrl = this.normalizeDownloadUrl(
        payload?.data?.downloadUrl || payload?.downloadUrl
      );
      if (payload?.status !== true || !downloadUrl) {
        throw new Error(payload?.message || 'SaveTube did not return a download URL');
      }

      return {
        status: true,
        creator: 'Chamod Nimsara',
        result: {
          title: info.title || `YouTube ${id}`,
          format,
          thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          duration: info.duration || null,
          cached: Boolean(info.fromCache),
          download_url: downloadUrl
        }
      };
    } catch (error) {
      const apiMessage = error.response?.data?.message;
      return {
        status: false,
        creator: 'Chamod Nimsara',
        message: apiMessage || error.message || 'Unable to create download link.'
      };
    }
  }
}

app.get('/', (_req, res) => {
  res.json({
    status: true,
    creator: 'Chamod Nimsara',
    message: 'SaveTube API is running on Vercel.'
  });
});

app.get('/download', async (req, res) => {
  const { url, format = 'mp3' } = req.query;
  if (!url) {
    return res.status(400).json({
      status: false,
      message: 'URL parameter is required.'
    });
  }

  const result = await new SaveTube().download(url, format);
  return res.status(result.status ? 200 : 502).json(result);
});

module.exports = app;

// Local development only: `node pasted_content_fixed.js`
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`API listening on port ${port}`));
}
