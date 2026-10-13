/* MediaRecorder wrapper: start / pause / resume / stop, elapsed time, audio level, full cleanup. */
(function () {
    var MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

    function Recorder(opts) {
        this.onTick = opts.onTick || function () { };
        this.onLevel = opts.onLevel || function () { };
        this.state = "idle"; // idle | recording | paused
        this.stream = null; this.mr = null; this.chunks = [];
        this.ctx = null; this.raf = 0; this.timer = 0;
        this.elapsed = 0; this.startedAt = 0;
    }

    Recorder.supported = function () {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    };

    Recorder.explain = function (err) {
        var n = err && err.name;
        if (!window.isSecureContext) return "Microphone access needs a secure page. Open the app via http://localhost or https.";
        if (n === "NotAllowedError" || n === "SecurityError") return "Microphone permission was denied. Allow microphone access in the browser's site settings and try again.";
        if (n === "NotFoundError" || n === "OverconstrainedError") return "No microphone was found. Connect a microphone or upload an audio file instead.";
        if (n === "NotReadableError") return "The microphone is in use by another application. Close it and try again.";
        return "Could not start recording: " + ((err && err.message) || "unknown error");
    };

    Recorder.prototype.start = async function () {
        if (this.state !== "idle") return;
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        var mime = MIMES.find(function (m) { return MediaRecorder.isTypeSupported(m); });
        try {
            this.mr = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
        } catch (e) { this.release(); throw e; }
        this.chunks = [];
        var self = this;
        this.mr.ondataavailable = function (e) { if (e.data && e.data.size) self.chunks.push(e.data); };
        this.mr.start(1000);
        this.state = "recording";
        this.elapsed = 0; this.startedAt = performance.now();
        this._startMeter();
        this.timer = setInterval(function () { self.onTick(self._elapsed()); }, 250);
    };

    Recorder.prototype._elapsed = function () {
        return this.state === "recording" ? this.elapsed + (performance.now() - this.startedAt) : this.elapsed;
    };

    Recorder.prototype._startMeter = function () {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
            this.ctx = new AC();
            var src = this.ctx.createMediaStreamSource(this.stream);
            var an = this.ctx.createAnalyser(); an.fftSize = 512;
            src.connect(an);
            var buf = new Uint8Array(an.fftSize), self = this;
            (function loop() {
                an.getByteTimeDomainData(buf);
                var sum = 0;
                for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
                self.onLevel(self.state === "recording" ? Math.min(1, Math.sqrt(sum / buf.length) * 4) : 0);
                self.raf = requestAnimationFrame(loop);
            })();
        } catch (e) { /* meter is optional */ }
    };

    Recorder.prototype.pause = function () {
        if (this.state !== "recording" || typeof this.mr.pause !== "function") return false;
        this.mr.pause(); this.elapsed = this._elapsed(); this.state = "paused"; return true;
    };
    Recorder.prototype.resume = function () {
        if (this.state !== "paused") return false;
        this.mr.resume(); this.startedAt = performance.now(); this.state = "recording"; return true;
    };

    Recorder.prototype.stop = function () {
        var self = this;
        return new Promise(function (resolve, reject) {
            if (self.state === "idle" || !self.mr) return resolve(null);
            var type = self.mr.mimeType || "audio/webm";
            var duration = self._elapsed();
            self.mr.onstop = function () {
                var blob = new Blob(self.chunks, { type: type });
                self.release();
                if (!blob.size || blob.size < 1000) return reject(new Error("The recording is empty. Check your microphone and try again."));
                resolve({ blob: blob, durationMs: duration });
            };
            self.mr.onerror = function (e) { self.release(); reject(e.error || new Error("Recording failed")); };
            try { self.mr.stop(); } catch (e) { self.release(); reject(e); }
        });
    };

    /** Release microphone + audio resources. Safe to call repeatedly. */
    Recorder.prototype.release = function () {
        clearInterval(this.timer); cancelAnimationFrame(this.raf);
        if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
        if (this.ctx && this.ctx.state !== "closed") this.ctx.close().catch(function () { });
        this.stream = null; this.ctx = null; this.mr = null; this.state = "idle";
        this.onLevel(0);
    };

    window.V2RRecorder = Recorder;
})();
