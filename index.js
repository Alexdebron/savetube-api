const express = require('express');
const crypto = require("crypto");
const axios = require("axios");

const app = express();

// SaveTube Class Logic
class Savetube {
    constructor() {
        this.ky = 'C5D58EF67A7584E4A29F6C35BBC4EB12';
        this.fmt = ['144', '240', '360', '480', '720', '1080', 'mp3'];
        this.m = /^((?:https?:)?\/\/)?((?:www|m|music)\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]{11})/;
        this.is = axios.create({
            headers: {
                'content-type': 'application/json',
                'origin': 'https://yt.savetube.me',
                'user-agent': 'Mozilla/5.0 (Android 15; Mobile; SM-F958; rv:130.0) Gecko/130.0 Firefox/130.0'
            }
        });
    }

    async decrypt(enc) {
        try {
            const [sr, ky] = [Buffer.from(enc, 'base64'), Buffer.from(this.ky, 'hex')];
            const [iv, dt] = [sr.slice(0, 16), sr.slice(16)];
            const dc = crypto.createDecipheriv('aes-128-cbc', ky, iv);
            return JSON.parse(Buffer.concat([dc.update(dt), dc.final()]).toString());
        } catch (e) {
            throw new Error(`Error while decrypting data: ${e.message}`);
        }
    }

    async getCdn() {
        try {
            const response = await this.is.get("https://media.savetube.vip/api/random-cdn");
            if (!response.status) return { status: false, msg: "CDN fetch failed" };
            return { status: true, data: response.data.cdn };
        } catch (e) {
            return { status: false, msg: "CDN Error", error: e.message };
        }
    }

    async download(url, format = 'mp3') {
        const id = url.match(this.m)?.[3];
        if (!id) {
            return { status: false, msg: "ID cannot be extracted from url" };
        }
        if (!format || !this.fmt.includes(format)) {
            return { status: false, msg: "Formats not found", list: this.fmt };
        }

        try {
            const u = await this.getCdn();
            if (!u.status) return u;

            const res = await this.is.post(`https://${u.data}/v2/info`, {
                url: `https://www.youtube.com/watch?v=${id}`
            });

            const dec = await this.decrypt(res.data.data);
            
            const dl = await this.is.post(`https://${u.data}/download`, {
                id: id,
                downloadType: format === 'mp3' ? 'audio' : 'video',
                quality: format === 'mp3' ? '128' : format,
                key: dec.key
            });

            return {
                status: true,
                creator: "Chamod Nimsara",
                result: {
                    title: dec.title,
                    format: format,
                    thumbnail: dec.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
                    duration: dec.duration,
                    cached: dec.fromCache,
                    download_url: dl.data.data.downloadUrl
                }
            };

        } catch (error) {
            return { status: false, creator: "Chamod Nimsara", error: error.message };
        }
    }
}

// --- Routes ---

app.get('/', (req, res) => {
    res.json({
        status: true,
        creator: "Chamod Nimsara",
        message: "SaveTube API is running on Vercel."
    });
});

app.get('/download', async (req, res) => {
    const url = req.query.url;
    const format = req.query.format || 'mp3';

    if (!url) {
        return res.status(400).json({
            status: false,
            creator: "Chamod Nimsara",
            message: "URL parameter is required."
        });
    }

    const downloader = new Savetube();
    const result = await downloader.download(url, format);

    res.json(result);
});

// Vercel requires exporting the app
module.exports = app;
