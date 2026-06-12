/* Telemetry page — shared helpers (formatting, escaping, CSV, download). */
window.TM = window.TM || {};

TM.util = (function() {
    function esc(str) {
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(str == null ? '' : String(str)));
        return d.innerHTML;
    }

    function formatDuration(ms) {
        if (!ms || ms <= 0) return '-';
        var totalSeconds = Math.floor(ms / 1000);
        var hours = Math.floor(totalSeconds / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;
        if (hours > 0) return hours + 'h' + String(minutes).padStart(2, '0') + 'm';
        return minutes + 'm' + String(seconds).padStart(2, '0') + 's';
    }

    function formatAgo(ms) {
        if (ms == null || !isFinite(ms)) return '-';
        // Phone clocks can run ahead of the server; clamp instead of failing.
        var s = Math.max(0, Math.floor(ms / 1000));
        if (s < 90) return s + 's';
        var m = Math.floor(s / 60);
        if (m < 90) return m + 'min';
        var h = Math.floor(m / 60);
        if (h < 36) return h + 'h' + String(m % 60).padStart(2, '0');
        return Math.floor(h / 24) + 'j';
    }

    function formatNumber(value, digits) {
        if (value == null || Number.isNaN(value)) return '-';
        return Number(value).toFixed(digits == null ? 0 : digits);
    }

    function formatGap(value) {
        if (value == null || Number.isNaN(value)) return '-';
        if (value >= 1000) return (value / 1000).toFixed(value >= 10000 ? 0 : 1) + 's';
        return value + 'ms';
    }

    function formatTime(value) {
        if (!value) return '-';
        var d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }

    function formatDateTime(value) {
        if (!value) return '-';
        var d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        return d.toLocaleString('fr-FR');
    }

    function dayKey(value) {
        var d = new Date(value);
        if (isNaN(d.getTime())) return '';
        // Local-time day key (YYYY-MM-DD)
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function dayLabel(key) {
        var todayKey = dayKey(Date.now());
        var yesterdayKey = dayKey(Date.now() - 86400000);
        var d = new Date(key + 'T12:00:00');
        var label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        if (key === todayKey) return 'Aujourd’hui — ' + label;
        if (key === yesterdayKey) return 'Hier — ' + label;
        return label;
    }

    function csvEscape(value) {
        var text = value == null ? '' : String(value);
        if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
        return text;
    }

    function toCsv(rows) {
        if (!rows.length) return '';
        var headers = Object.keys(rows[0]);
        var lines = [headers.join(',')];
        rows.forEach(function(row) {
            lines.push(headers.map(function(header) { return csvEscape(row[header]); }).join(','));
        });
        return lines.join('\n');
    }

    function downloadText(filename, content, mimeType) {
        var blob = new Blob([content], { type: mimeType });
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }

    // Composite anomaly penalty (internal); 0 = clean walk.
    function healthPenalty(s) {
        var score = 0;
        score += (Number(s.sleepSuspects) || 0) * 3;
        score += (Number(s.staleCallbacks) || 0);
        score += (Number(s.rejectedFixes) || 0) * 0.25;
        score += (Number(s.audioErrors) || 0);
        score += (Number(s.userLostCount) || 0) * 0.5;
        var gap = Number(s.maxGapMs);
        if (gap >= 30000) score += 3;
        else if (gap >= 8000) score += 1;
        var acc = Number(s.avgAccuracy);
        if (acc > 20) score += 3;
        else if (acc > 10) score += 1;
        return score;
    }

    // Public health score, normalized 0..100 where 100 = perfect session.
    function healthScore(s) {
        return Math.max(0, Math.min(100, Math.round(100 - healthPenalty(s) * 10)));
    }

    function healthColor(score100) {
        if (score100 >= 80) return '#198754';
        if (score100 >= 40) return '#ffc107';
        return '#dc3545';
    }

    return {
        esc: esc,
        formatDuration: formatDuration,
        formatAgo: formatAgo,
        formatNumber: formatNumber,
        formatGap: formatGap,
        formatTime: formatTime,
        formatDateTime: formatDateTime,
        dayKey: dayKey,
        dayLabel: dayLabel,
        toCsv: toCsv,
        downloadText: downloadText,
        healthScore: healthScore,
        healthColor: healthColor
    };
})();
