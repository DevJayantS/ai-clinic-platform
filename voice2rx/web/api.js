/* Frontend service layer. UI code never calls fetch directly.
   Patient data only goes to the LOCAL Voice2Rx server (default http://localhost:8787). */
(function () {
    var C = window.V2RClinical;
    var base = window.VOICE2RX_API || (location.port === "8787" ? "" : "http://localhost:8787");
    var SESSION_KEY = "v2r_demo_consultations"; // sessionStorage: tab-lifetime, synthetic demo data only

    async function call(path, opts, timeoutMs) {
        var res;
        try {
            res = await fetch(base + path, Object.assign({ signal: AbortSignal.timeout(timeoutMs || 15000) }, opts));
        } catch (e) {
            throw new Error("Cannot reach the local Voice2Rx server.");
        }
        var data = null;
        try { data = await res.json(); } catch (e) { /* non-JSON */ }
        if (!res.ok) {
            var err = new Error((data && data.error) || "Request failed (" + res.status + ")");
            err.code = data && data.code; err.status = res.status;
            throw err;
        }
        return data;
    }

    var Api = {
        reachable: false,

        async status() {
            try {
                var s = await call("/api/status", {}, 4000);
                Api.reachable = true;
                return s;
            } catch (e) {
                Api.reachable = false;
                return null;
            }
        },

        /** transcriptionService */
        transcribe: function (blob, ext) {
            return call("/api/transcribe", { method: "POST", headers: { "X-Audio-Ext": ext }, body: blob }, 11 * 60 * 1000);
        },

        /** clinicalExtractionService: server (Ollama or rule-based) when reachable, otherwise local rule-based. */
        extract: async function (transcript, useServer) {
            if (useServer && Api.reachable) {
                return call("/api/extract", {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: transcript })
                }, 4 * 60 * 1000);
            }
            return { mode: "basic", model: "", extraction: C.basicExtract(transcript), notice: "" };
        },

        /** consultationService */
        store: {
            async list() {
                if (Api.reachable) return call("/api/consultations", {});
                try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "[]"); } catch (e) { return []; }
            },
            async get(id) {
                var l = await Api.store.list();
                return l.find(function (c) { return c.id === id; }) || null;
            },
            async save(rec, id) {
                if (Api.reachable) {
                    return id
                        ? call("/api/consultations/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) })
                        : call("/api/consultations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) });
                }
                var list = [];
                try { list = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "[]"); } catch (e) { }
                var now = new Date().toISOString();
                var idx = id ? list.findIndex(function (c) { return c.id === id; }) : -1;
                var out = Object.assign({}, rec, { id: id || "demo-" + Date.now().toString(36), createdAt: idx >= 0 ? list[idx].createdAt : now, updatedAt: now });
                if (idx >= 0) list[idx] = out; else list.push(out);
                sessionStorage.setItem(SESSION_KEY, JSON.stringify(list));
                return out;
            }
        }
    };

    window.V2RApi = Api;
})();
