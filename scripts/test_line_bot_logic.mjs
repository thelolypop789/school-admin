// เทสต์ตรรกะบอท LINE (รันจาก root ของ repo: node scripts/test_line_bot_logic.mjs)
import ts from 'typescript';
import fs from 'fs';
import os from 'os';
import path from 'path';
const src = fs.readFileSync('supabase/functions/line-bot/logic.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const out = path.join(os.tmpdir(), 'school_line_bot_logic.mjs');
fs.writeFileSync(out, js);
const L = await import(out);
let n = 0, bad = 0; const t = (name, c) => { n++; if (!c) { bad++; console.log('FAIL', name); } };

// postback ไป-กลับ และกันข้อมูลแปลก
const d = L.postbackData('forward', 12, 'pending_deputy');
t('postback round trip', JSON.stringify(L.parsePostback(d)) === JSON.stringify({ a: 'forward', id: 12, s: 'pending_deputy' }));
t('postback rejects unknown action', L.parsePostback('v=1&a=delete&id=1&s=pending') === null);
t('postback rejects bad id', L.parsePostback('v=1&a=forward&id=abc&s=pending') === null && L.parsePostback('v=1&a=forward&id=-3&s=x') === null);
t('postback needs version + status', L.parsePostback('a=forward&id=1&s=pending') === null && L.parsePostback('v=1&a=forward&id=1') === null);
t('postback data fits LINE 300-char limit', d.length < 300);

// ข้อความ
t('link code = exactly 6 digits', L.isLinkCode('123456') && L.isLinkCode(' 012345 ') && !L.isLinkCode('12345') && !L.isLinkCode('1234567') && !L.isLinkCode('12a456'));
t('queue command', L.isQueueCommand('งาน') && L.isQueueCommand('รอ อนุมัติ') && !L.isQueueCommand('งานเลี้ยง'));
t('cancel', L.isCancel('ยกเลิก') && L.isCancel('Cancel') && !L.isCancel('ยกเลิกการเดินทาง'));
t('error codes from DB messages', L.errorCode('ERROR: not_pending') === 'not_pending' && L.errorCode('P0001: use_app') === 'use_app' && L.errorCode('boom') === 'unknown');
t('unknown error has fallback text', L.errorText('boom').length > 10);

// ลายเซ็น
t('signature equal', L.signatureOk('abc=', 'abc='));
t('signature differs / missing', !L.signatureOk('abc=', 'abd=') && !L.signatureOk('abc=', null) && !L.signatureOk('', '') && !L.signatureOk('abc=', 'abc'));

// วันที่เป็นเวลาไทย
const r = L.fmtRange('2026-11-20T01:00:00Z', '2026-11-20T09:30:00Z');
t('same-day range in Bangkok time', r.includes('08:00') && r.includes('16:30') && !r.includes(' – '));
const r2 = L.fmtRange('2026-11-20T01:00:00Z', '2026-11-21T10:00:00Z');
t('multi-day range', r2.includes(' – ') && r2.includes('17:00'));

// แผนแจ้งเตือน
const base = { id: 7, destination: 'สพม.หนองคาย', purpose: 'ประชุม', passengers: 2, starts_at: '2026-11-20T01:00:00Z', ends_at: '2026-11-20T09:00:00Z',
  approver_note: null, travelers: [{ name: 'นายก', position: 'ครู' }], requester: { full_name: 'ครู บี', line_user_id: 'Ureq' },
  vehicle: { name: 'รถตู้', plate: 'นข-1' }, driver: { full_name: 'นายขับ' } };
const plan = (status, from = null, extra = {}) => L.notifyPlan({ ...base, status, ...extra }, from, 'https://app');
const roles = (p) => p.map((x) => x.to === 'requester' ? 'requester' : x.to.role).join(',');
t('new request → vehicle head', roles(plan('pending')) === 'vehicle_head');
t('pending_deputy → deputy', roles(plan('pending_deputy', 'pending')) === 'deputy');
t('pending_director → director', roles(plan('pending_director', 'pending_deputy')) === 'director');
t('approved → requester + vehicle head', roles(plan('approved', 'pending_director')) === 'requester,vehicle_head');
t('returned → requester', roles(plan('returned', 'pending')) === 'requester');
t('rejected → requester', roles(plan('rejected', 'pending_director')) === 'requester');
t('cancel while waiting deputy → deputy', roles(plan('cancelled', 'pending_deputy')) === 'deputy');
t('on_trip / completed → nobody', plan('on_trip', 'approved').length === 0 && plan('completed', 'on_trip').length === 0);
const json = (p) => JSON.stringify(p);
t('sent back title when director returns', json(plan('pending_deputy', 'pending_director')).includes('ถูกส่งกลับมาให้พิจารณาใหม่'));
t('returned shows reason', json(plan('returned', 'pending', { approver_note: 'ขาดรายชื่อ' })).includes('ขาดรายชื่อ'));

// ปุ่มตามขั้น
const card = (status) => JSON.stringify(L.reviewCard({ ...base, status }, 'https://app'));
const acts = (status) => [...card(status).matchAll(/"data":"([^"]+)"/g)].map((m) => L.parsePostback(m[1]).a).join(',');
t('deputy: forward + return', acts('pending_deputy') === 'forward,return');
t('director: forward + return + reject', acts('pending_director') === 'forward,return,reject');
t('head: no postback (use app)', acts('pending') === '' && card('pending').includes('https://app/vehicles'));
t('buttons carry current status', card('pending_director').includes(encodeURIComponent('pending_director')) || card('pending_director').includes('s=pending_director'));
const labels = [...card('pending_director').matchAll(/"label":"([^"]+)"/g)].map((m) => m[1]);
t('button labels ≤ 20 chars', labels.every((l) => [...l].length <= 20));
const q = L.queueMessage([{ ...base, status: 'pending_director' }], 'https://app');
t('queue → carousel', q.type === 'flex' && q.contents.type === 'carousel' && q.contents.contents.length === 1);
t('empty queue → text', L.queueMessage([], 'x').type === 'text');
t('altText ≤ 400', plan('pending_director', null, { destination: 'ก'.repeat(500) })[0].messages[0].altText.length <= 400);

const uris = [...card('pending_deputy').matchAll(/"uri":"([^"]+)"/g)].map((m) => m[1]);
t('app links open in external browser (Google blocks LINE webview login)', uris.length > 0 && uris.every((u) => u.endsWith('openExternalBrowser=1')));
t('externalUrl keeps existing query', L.externalUrl('https://a/b?x=1') === 'https://a/b?x=1&openExternalBrowser=1');

// ---------------- แจ้งซ่อมงานอาคารสถานที่
const rep = { id: 5, title: 'หลอดไฟห้อง 201 เสีย', detail: 'ดับสนิท', location: 'อาคาร 2 ห้อง 201', category: 'electric', priority: 'high',
  status: 'new', plan_start: '2026-11-27', plan_end: '2026-11-27', proposal: 'ช่างว่างวันพฤหัส', exec_decision: null, exec_note: null, done_note: null,
  reporter: { full_name: 'ครู เอ', line_user_id: 'Ua' } };
const rplan = (status, from = null, extra = {}) => L.repairNotifyPlan({ ...rep, status, ...extra }, from, 'https://app');
const rroles = (p) => p.map((x) => x.to === 'requester' ? 'requester' : x.to.role).join(',');
t('repair new → facilities head', rroles(rplan('new')) === 'facilities_head');
t('repair new shows priority in title', JSON.stringify(rplan('new')).includes('ด่วน'));
t('repair proposed → deputy', rroles(rplan('proposed', 'new')) === 'deputy');
t('repair scheduled → reporter', rroles(rplan('scheduled', 'proposed')) === 'requester');
t('repair done → reporter', rroles(rplan('done', 'scheduled')) === 'requester');
t('repair sent back (urgent) → facilities head with exec note', rroles(rplan('new', 'proposed', { exec_decision: 'urgent', exec_note: 'ห้องสอบวันจันทร์' })) === 'facilities_head'
  && JSON.stringify(rplan('new', 'proposed', { exec_decision: 'urgent', exec_note: 'ห้องสอบวันจันทร์' })).includes('ห้องสอบวันจันทร์'));
t('repair sent back (defer) title', JSON.stringify(rplan('new', 'proposed', { exec_decision: 'defer' })).includes('ทำงานอื่นก่อน'));
t('repair cancelled while proposed → deputy; otherwise nobody', rroles(rplan('cancelled', 'proposed')) === 'deputy' && rplan('cancelled', 'new').length === 0);
t('repair in-progress statuses nobody else', rplan('proposed', 'scheduled').length === 1);

const rcard = (status) => JSON.stringify(L.repairCard({ ...rep, status }, 'https://app'));
const racts = (status) => [...rcard(status).matchAll(/"data":"([^"]+)"/g)].map((m) => L.parseRepairPostback(m[1]).a).join(',');
t('repair proposed card: agree + urgent + defer', racts('proposed') === 'agree,urgent,defer');
t('repair new card: no decision buttons', racts('new') === '' && rcard('new').includes('https://app/facilities'));
const rd = L.repairPostbackData('urgent', 9, 'proposed');
t('repair postback round trip', JSON.stringify(L.parseRepairPostback(rd)) === JSON.stringify({ a: 'urgent', id: 9, s: 'proposed' }));
t('repair postback is not a booking postback and vice versa', L.parsePostback(rd) === null && L.parseRepairPostback(L.postbackData('forward', 3, 'pending_deputy')) === null);
t('repair postback rejects unknown decision / bad id', L.parseRepairPostback('v=1&k=r&a=delete&id=1&s=proposed') === null && L.parseRepairPostback('v=1&k=r&a=agree&id=0&s=proposed') === null);
t('repair postback fits 300 chars', rd.length < 300);
const rlabels = [...rcard('proposed').matchAll(/"label":"([^"]+)"/g)].map((m) => m[1]);
t('repair button labels ≤ 20 chars', rlabels.every((l) => [...l].length <= 20));
const ruris = [...rcard('proposed').matchAll(/"uri":"([^"]+)"/g)].map((m) => m[1]);
t('repair links open in external browser', ruris.length > 0 && ruris.every((u) => u.endsWith('openExternalBrowser=1')));
t('repair altText ≤ 400', rplan('proposed', 'new', { title: 'ก'.repeat(500) })[0].messages[0].altText.length <= 400);
t('long detail truncated', JSON.stringify(L.repairCard({ ...rep, detail: 'ข'.repeat(300) }, 'x')).length < JSON.stringify(L.repairCard({ ...rep, detail: 'ข'.repeat(30) }, 'x')).length + 300);
t('plan range formats one day and range', L.planRange('2026-11-27', '2026-11-27') === L.planRange('2026-11-27', null) && L.planRange('2026-11-27', '2026-11-28').includes(' – ') && L.planRange(null, null) === '-');
const mixed = L.queueMessage([{ ...base, status: 'pending_director' }], 'https://app', [{ ...rep, status: 'proposed' }]);
t('queue merges bookings + repairs in one carousel', mixed.type === 'flex' && mixed.contents.contents.length === 2);
t('queue only repairs', L.queueMessage([], 'https://app', [{ ...rep, status: 'proposed' }]).contents.contents.length === 1);
t('queue caps at 10', L.queueMessage([], 'x', Array.from({ length: 14 }, () => ({ ...rep, status: 'proposed' }))).contents.contents.length === 10);
t('repair done texts mention title', ['agree', 'urgent', 'defer'].every((d) => L.repairDoneText(d, 'เรื่องX').includes('เรื่องX')));
t('bad_action has Thai text', L.errorText('ERROR: bad_action').includes('ปุ่ม'));
// ดีไซน์รอบ 2: หัวการ์ดเป็นแผ่นสีประจำงาน
const hb = JSON.parse(card('pending_deputy')).header;
t('booking header is car gradient', hb.background?.type === 'linearGradient' && hb.background.endColor === L.MOD.car.end);
const hr = JSON.parse(rcard('proposed')).header;
t('repair header is orange gradient', hr.background?.type === 'linearGradient' && hr.background.endColor === L.MOD.fix.end);
t('urgent priority value is red', JSON.stringify(L.repairCard({ ...rep, priority: 'urgent' }, 'x')).includes('#d92d20'));

// เขตทำความสะอาด: แจ้งครูที่ปรึกษาเมื่อผล "ต้องปรับปรุง"
const cf = { id: 5, date: '2026-11-20', result: 'fail', note: 'ขยะใต้ต้นไม้', class_name: 'ม.2/2', area: 'โดม', line_ids: ['U1', 'U2', 'U1'] };
const cm = L.cleanFailMessages(cf, 'https://app');
t('clean fail goes to advisors (deduped)', JSON.stringify(cm.to) === JSON.stringify(['U1', 'U2']) && cm.messages.length === 1);
t('clean fail card has note + green header + link', (() => { const j = JSON.stringify(cm.messages[0]); return j.includes('ขยะใต้ต้นไม้') && j.includes('#3f8f1c') && j.includes('https://app/facilities/zones?openExternalBrowser=1'); })());
t('clean fail alt text', cm.messages[0].altText.startsWith('เขต ม.2/2 ต้องปรับปรุง'));
t('clean: result changed → no send', L.cleanFailMessages({ ...cf, result: 'pass' }, 'x').to.length === 0);
t('clean: no linked advisor → no send', L.cleanFailMessages({ ...cf, line_ids: [] }, 'x').to.length === 0 && L.cleanFailMessages(null, 'x').to.length === 0);
t('clean: long note truncated', JSON.stringify(L.cleanFailCard({ ...cf, note: 'ก'.repeat(500) }, 'x')).length < 4000);


// ห้องพักงานแข่งขัน: แจ้งฝ่ายจัดห้องเมื่อมีคำขอใหม่
const lq = { id: 9, status: 'pending', school_name: 'โรงเรียนทดสอบ', contact_name: 'ครูสมชาย', male_students: 10, female_students: 12, teachers: 2, event_name: 'การแข่งขันปาริชาติ' };
const lm = L.lodgingNewMessages(lq, 'https://app');
t('lodging card: 1 message, total + link', lm.length === 1 && JSON.stringify(lm[0]).includes('24 คน') && JSON.stringify(lm[0]).includes('https://app/lodging?openExternalBrowser=1'));
t('lodging card: no phone number', !JSON.stringify(lm[0]).includes('08'));
t('lodging: not pending → nothing', L.lodgingNewMessages({ ...lq, status: 'cancelled' }, 'x').length === 0 && L.lodgingNewMessages(null, 'x').length === 0);

// แจ้งเหตุ
const iq = { id: 5, category: 'blocked', location: 'ประตูหน้าโรงเรียน', detail: 'กระบะขาว กข 1234', reporter_name: 'ครูเอ', phone: '081-234-5678', school_name: 'โรงเรียนทดสอบ', status: 'new', has_photo: true, created_at: '2026-12-21T01:30:00Z', event_name: 'การแข่งขันปาริชาติ' };
const im = JSON.stringify(L.incidentMessages(iq, 'https://app'));
t('incident card: category, place, call button, link', im.includes('รถขวางทางเข้าออก') && im.includes('ประตูหน้าโรงเรียน') && im.includes('tel:0812345678') && im.includes('https://app/lodging?tab=incidents&openExternalBrowser=1'));
t('incident card: time in Thai zone', im.includes('08:30'));
t('incident: only new → card', L.incidentMessages({ ...iq, status: 'acknowledged' }, 'x').length === 0 && L.incidentMessages(null, 'x').length === 0);
t('incident roles by category', L.incidentRoles('blocked').includes('vehicle_head') && L.incidentRoles('water').includes('inspector') && !L.incidentRoles('medical').includes('inspector') && L.incidentRoles('other').includes('facilities_head'));
const ip = L.incidentPostbackData('ack', 5);
t('incident postback round trip', JSON.stringify(L.parseIncidentPostback(ip)) === JSON.stringify({ a: 'ack', id: 5 }));
t('incident postback not mixed up with others', L.parseRepairPostback(ip) === null && L.parsePostback(ip) === null && L.parseIncidentPostback(L.repairPostbackData('agree', 1, 'proposed')) === null);
t('incident postback rejects bad', L.parseIncidentPostback('v=1&k=i&a=delete&id=5') === null && L.parseIncidentPostback('v=1&k=i&a=ack&id=0') === null);
t('incident ack reply has done quick reply', JSON.stringify(L.incidentDoneReply('ack', iq, 5)).includes(L.incidentPostbackData('done', 5)));
t('incident not_pending text', L.incidentErrorText('ERROR: not_pending').includes('รับหรือปิดไปแล้ว'));

console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
