import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
    const options = {
        dir: path.resolve(__dirname, '..', 'telemetry'),
        parcours: null,
        date: null,
        session: null,
        json: false,
    };

    for (const arg of argv) {
        if (arg === '--json') options.json = true;
        else if (arg.startsWith('--dir=')) options.dir = path.resolve(arg.slice('--dir='.length));
        else if (arg.startsWith('--parcours=')) options.parcours = arg.slice('--parcours='.length);
        else if (arg.startsWith('--date=')) options.date = normalizeDateFilter(arg.slice('--date='.length));
        else if (arg.startsWith('--session=')) options.session = arg.slice('--session='.length);
        else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        }
    }

    return options;
}

function printHelp() {
    console.log([
        'Usage: npm run telemetry:report -- [--parcours=FRAPPAZ_V10] [--date=20260507] [--session=20260507_133155_ccyr] [--json]',
        '',
        'Options:',
        '  --dir=PATH        Telemetry directory (defaults to ./telemetry)',
        '  --parcours=ID     Filter by parcours name or id (case-insensitive contains match)',
        '  --date=YYYYMMDD   Filter by session start date',
        '  --session=ID      Filter by session id contains match',
        '  --json            Output JSON instead of a text table',
    ].join('\n'));
}

function normalizeDateFilter(value) {
    if (!value) return null;
    return value.replace(/-/g, '');
}

function formatDay(value) {
    if (!value) return '';
    return value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8);
}

function formatDuration(ms) {
    if (!ms || ms <= 0) return '-';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
    return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

function average(values) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getSessionDay(session) {
    const source = session.startTime || (session.events && session.events[0] && session.events[0].t ? new Date(session.events[0].t).toISOString() : null);
    if (!source) return null;
    return source.slice(0, 10).replace(/-/g, '');
}

function matchText(haystack, needle) {
    if (!needle) return true;
    return String(haystack || '').toLowerCase().includes(String(needle).toLowerCase());
}

function summarizeSession(session) {
    const events = Array.isArray(session.events) ? session.events : [];
    const gpsEvents = events.filter(event => event.type === 'gps' && event.data && typeof event.data.lat === 'number' && typeof event.data.lng === 'number');
    const gpsQualitySummaries = events.filter(event => event.type === 'gps_quality_summary');
    const routeProbes = events.filter(event => event.type === 'route_probe');
    const stepFires = events.filter(event => event.type === 'step_fire');
    const uniqueSteps = [...new Set(stepFires.map(event => event.data && event.data.step).filter(step => Number.isInteger(step)))];
    const finalRouteProbe = [...routeProbes].reverse().find(event => event.data && Number.isInteger(event.data.currentStep));
    const finalStep = finalRouteProbe ? finalRouteProbe.data.currentStep : (uniqueSteps.length ? Math.max(...uniqueSteps) : null);
    const gpsAccuracies = gpsEvents.map(event => event.data.acc).filter(value => typeof value === 'number' && !Number.isNaN(value));
    const gpsGapEvents = events.filter(event => event.type === 'gps_callback_gap');
    const maxGapMs = Math.max(
        0,
        ...gpsGapEvents.map(event => Number(event.data && event.data.gapMs) || 0),
        ...gpsQualitySummaries.map(event => Number(event.data && event.data.maxGapMs) || 0)
    ) || null;
    const sleepSuspects = events.filter(event => event.type === 'gps_sleep_suspect').length;
    const staleCallbacks = events.filter(event => event.type === 'gps_stale_callback').length;
    const rejectedFixes = gpsQualitySummaries.length
        ? gpsQualitySummaries.reduce((sum, event) => sum + (Number(event.data && event.data.rejectedSamples) || 0), 0)
        : events.filter(event => event.type === 'gps_trigger_rejected').length;
    const heartbeatRecoveries = events.filter(event => event.type === 'gps_heartbeat_ok').length;
    const gpsLostCount = events.filter(event => event.type === 'gps_state' && event.data && event.data.state === 'lost').length;
    const audioErrors = events.filter(event => event.type === 'audio_loaderror' || event.type === 'audio_playerror').length;
    const startMs = events[0] ? events[0].t : (session.startTime ? Date.parse(session.startTime) : null);
    const endMs = events.length > 0 ? events[events.length - 1].t : startMs;

    return {
        sessionId: session.sessionId,
        parcoursId: session.parcoursId,
        parcoursName: session.parcoursName,
        startTime: session.startTime,
        day: getSessionDay(session),
        deviceModel: session.client && session.client.deviceModel ? session.client.deviceModel : '',
        osVersion: session.client && session.client.osVersion ? session.client.osVersion : '',
        durationMs: startMs && endMs ? Math.max(0, endMs - startMs) : 0,
        eventCount: events.length,
        finalStep,
        uniqueStepCount: uniqueSteps.length,
        gpsCount: gpsEvents.length,
        avgAcc: average(gpsAccuracies),
        maxGapMs,
        sleepSuspects,
        staleCallbacks,
        rejectedFixes,
        heartbeatRecoveries,
        gpsLostCount,
        audioErrors,
        resumeCount: events.filter(event => event.type === 'session_resume').length,
    };
}

function loadSessions(dirPath) {
    if (!fs.existsSync(dirPath)) throw new Error(`Telemetry directory not found: ${dirPath}`);

    return fs.readdirSync(dirPath)
        .filter(file => file.endsWith('.json'))
        .map(file => JSON.parse(fs.readFileSync(path.join(dirPath, file), 'utf8')))
        .sort((left, right) => {
            const leftTs = left.events && left.events.length ? left.events[left.events.length - 1].t : 0;
            const rightTs = right.events && right.events.length ? right.events[right.events.length - 1].t : 0;
            return rightTs - leftTs;
        });
}

function printTable(rows) {
    const headers = ['Session', 'Parcours', 'Date', 'Device', 'Dur', 'Step', 'GPS', 'AvgAcc', 'MaxGap', 'Sleep', 'Stale', 'Reject', 'Audio'];
    const body = rows.map(row => [
        row.sessionId,
        row.parcoursName || row.parcoursId || '-',
        formatDay(row.day),
        row.deviceModel || '-',
        formatDuration(row.durationMs),
        row.finalStep == null ? '-' : String(row.finalStep),
        String(row.gpsCount),
        row.avgAcc == null ? '-' : row.avgAcc.toFixed(1),
        row.maxGapMs == null ? '-' : String(row.maxGapMs),
        String(row.sleepSuspects),
        String(row.staleCallbacks),
        String(row.rejectedFixes),
        String(row.audioErrors),
    ]);

    const widths = headers.map((header, index) => Math.max(header.length, ...body.map(row => row[index].length)));
    const lines = [];
    lines.push(headers.map((header, index) => header.padEnd(widths[index])).join('  '));
    lines.push(widths.map(width => '-'.repeat(width)).join('  '));
    body.forEach(row => lines.push(row.map((cell, index) => cell.padEnd(widths[index])).join('  ')));
    console.log(lines.join('\n'));
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const sessions = loadSessions(options.dir);
    const filtered = sessions.filter(session => {
        const summary = summarizeSession(session);
        return matchText(summary.parcoursName || summary.parcoursId, options.parcours)
            && matchText(summary.sessionId, options.session)
            && (!options.date || summary.day === options.date);
    }).map(summarizeSession);

    if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
    }

    if (filtered.length === 0) {
        console.log('No telemetry sessions matched the selected filters.');
        return;
    }

    printTable(filtered);
}

main();