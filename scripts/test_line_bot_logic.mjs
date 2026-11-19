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
console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
