/**
 * なかまボード（無料で使える、仲間の連絡・共有ボード） by ユーカリデジタル https://eucalydigital.com/
 *  第1段階：ログイン・メンバー管理・招待コード
 *  第2段階：掲示板・お知らせ・コメント（画像・PDFの添付つき）
 *  第3段階：カレンダー（繰り返し予定つき）
 *  第4段階：グループ・メッセージ（1対1・グループ、既読つき）
 *  第5段階：区域カード（貸し出し・返却、地図への書き込み、コメント、スプレッドシート連携）
 *  第6段階：未読のまとめメール（朝7時・夕方18時に自動送信）
 *
 * 初回のみ：エディタ上部で関数「setup」を選んで実行し、
 * 実行ログに表示される「初期管理者の招待コード」でアプリに登録してください。
 */

// ===== 設定 =====
const APP_NAME = 'なかまボード';   // 最初のアプリ名（全体管理者が「メンバー管理 → アプリの設定」で変更できます）
const SESSION_DAYS = 30;            // ログイン状態を保つ日数
const HASH_ROUNDS = 300;            // パスワードのハッシュ計算の回数
const MAX_LOGIN_FAILS = 5;          // この回数失敗すると10分ロック

const SHEETS = {
  Users: ['id', 'loginId', 'name', 'email', 'passHash', 'salt', 'role', 'territoryAdmin', 'active', 'createdAt', 'lastLoginAt', 'calendarEditor', 'digestOff', 'lastDigestAt', 'withdrawnAt'],
  Invites: ['code', 'role', 'createdBy', 'createdAt', 'expiresAt', 'usedBy', 'usedAt', 'note'],
  Sessions: ['token', 'userId', 'createdAt', 'expiresAt'],
  Posts: ['id', 'type', 'title', 'body', 'authorId', 'important', 'createdAt', 'updatedAt', 'deleted', 'groupId'],
  Comments: ['id', 'postId', 'authorId', 'body', 'createdAt', 'deleted'],
  ReadMarks: ['postId', 'userIds'],   // 投稿ごとに1行、既読の人のIDをカンマ区切りで保存
  Files: ['id', 'driveId', 'ownerType', 'ownerId', 'name', 'mime', 'size', 'uploadedBy', 'createdAt', 'deleted', 'expired'],
  Events: ['id', 'title', 'startDate', 'allDay', 'startTime', 'endTime', 'location', 'memo',
    'repeat', 'weekdays', 'monthNth', 'untilDate', 'exdates', 'scope', 'groupId',
    'createdBy', 'createdAt', 'updatedAt', 'deleted'],
  Groups: ['id', 'name', 'description', 'features', 'createdBy', 'createdAt', 'updatedAt', 'deleted'],
  GroupMembers: ['groupId', 'userId', 'role', 'joinedAt'],
  DmPairs: ['id', 'userA', 'userB', 'createdAt'],
  Messages: ['id', 'convId', 'authorId', 'body', 'createdAt', 'deleted'],
  ChatReads: ['convId', 'userId', 'lastReadAt'],
  Territories: ['id', 'number', 'name', 'type', 'fileId', 'sheetId', 'sheetGid', 'sheetUrl', 'available',
    'holderId', 'holderName', 'borrowedAt', 'dueDate', 'lastUserId', 'lastUserName', 'lastUsedDate', 'lastReturnedAt',
    'createdAt', 'updatedAt', 'deleted'],
  TerritoryLog: ['id', 'territoryId', 'userId', 'userName', 'borrowedAt', 'dueDate', 'returnedAt', 'usedDate', 'operatorId'],
  TerritoryComments: ['id', 'territoryId', 'authorId', 'body', 'warn', 'createdAt', 'deleted'],
  TerritoryInk: ['territoryId', 'data', 'updatedAt', 'updatedBy']
};

// 区域カード
const DEFAULT_DUE_DAYS = 14;
const COMMENT_AFTER_RETURN_HOURS = 72;   // 返却した人がコメントを追加できる時間
const MAX_INK_CHARS = 45000;             // 書き込みデータの上限（スプレッドシートのセルの上限より小さく）
const LIST_MAX_ROWS = 500;
const LIST_MAX_COLS = 26;

const GROUP_FEATURES = ['board', 'calendar', 'chat'];
const CHAT_PAGE = 100;

// 添付ファイルの制限
const MAX_FILES = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CHAT_FILE_KEEP_MONTHS = 6;   // メッセージの添付ファイルを残す期間（この期間を過ぎると自動で削除）
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

// ===== Webアプリの入口 =====
function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  const name = appName_();
  const icon = iconUrl_();
  t.appName = name;
  t.iconUrl = iconData_();   // 画面に出すアイコンは、ページに直接埋め込む（ドライブのURLは画像として表示できないことがあるため）
  const out = t.evaluate()
    .setTitle(name)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  // ホーム画面に追加したときの見た目（使えない環境でも表示は止めない）
  [['mobile-web-app-capable', 'yes'], ['apple-mobile-web-app-capable', 'yes'], ['apple-mobile-web-app-title', name]].forEach(function (m) {
    try { out.addMetaTag(m[0], m[1]); } catch (e) { /* 対応していないタグは使わない */ }
  });
  if (icon) {
    try { out.setFaviconUrl(icon); } catch (e) { /* アイコンが使えなくても表示は続ける */ }
  }
  return out;
}

// ===== アプリの設定（全体管理者） =====
// 機能のオン・オフ（アプリ全体）
const APP_FEATURES = ['board', 'calendar', 'chat', 'groups', 'cards'];
const APP_FEATURE_NAMES = { board: '掲示板', calendar: '予定', chat: 'メッセージ', groups: 'グループ', cards: '共有カード' };
let featuresCache_ = null;
function appFeatures_() {
  if (featuresCache_) return featuresCache_;
  let saved = {};
  try { saved = JSON.parse(PropertiesService.getScriptProperties().getProperty('FEATURES') || '{}'); } catch (e) { saved = {}; }
  const out = {};
  APP_FEATURES.forEach(function (f) { out[f] = saved[f] !== false; });
  featuresCache_ = out;
  return out;
}
function featureOn_(f) {
  return appFeatures_()[f] !== false;
}
function requireFeature_(f) {
  if (!featureOn_(f)) throw new Error('「' + (APP_FEATURE_NAMES[f] || f) + '」は、現在使えないように設定されています。');
}

function appName_() {
  return PropertiesService.getScriptProperties().getProperty('APP_NAME') || APP_NAME;
}
function iconUrl_() {
  const id = PropertiesService.getScriptProperties().getProperty('ICON_ID');
  // ブラウザのタブのアイコン用。GAS は末尾に拡張子のあるURLでないと受け付けないため「&.png」を付ける
  return id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w256&.png' : '';
}

// 画面表示用の小さいアイコン（data URL）。毎回ドライブを読まないよう、キャッシュに置く
function iconData_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ICON_SMALL_ID') || props.getProperty('ICON_ID');
  if (!id) return '';
  const cache = CacheService.getScriptCache();
  const key = 'icon_' + id;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const blob = DriveApp.getFileById(id).getBlob();
    const url = 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
    if (url.length < 90000) cache.put(key, url, 21600);
    return url.length < 400000 ? url : '';
  } catch (e) {
    return '';
  }
}

function api_getAppSettings(token) {
  requireAdmin_(token);
  return { name: appName_(), iconUrl: iconData_(), defaultName: APP_NAME, features: appFeatures_() };
}

// name：アプリ名。iconBase64：新しいアイコン（PNG・512px）。smallBase64：画面表示用（JPEG・192px）。removeIcon：アイコンを外す
function api_saveAppSettings(token, name, iconBase64, removeIcon, smallBase64, features) {
  requireAdmin_(token);
  name = String(name || '').trim();
  if (!name || name.length > 20) throw new Error('アプリ名は1〜20文字で入力してください。');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('APP_NAME', name);
  if (features && typeof features === 'object') {
    const f = {};
    APP_FEATURES.forEach(function (k) { f[k] = features[k] !== false; });
    props.setProperty('FEATURES', JSON.stringify(f));
    featuresCache_ = null;
  }
  if (iconBase64 || removeIcon) {
    ['ICON_ID', 'ICON_SMALL_ID'].forEach(function (k) {
      const oldId = props.getProperty(k);
      if (!oldId) return;
      try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { /* すでにない */ }
      props.deleteProperty(k);
    });
  }
  if (iconBase64) {
    const bytes = Utilities.base64Decode(String(iconBase64));
    if (bytes.length > 1024 * 1024) throw new Error('アイコン画像が大きすぎます。');
    // アイコンだけは誰でも見られるようにする（ホーム画面のアイコンに使うため）。添付ファイルのフォルダとは別に保存
    const file = DriveApp.createFile(Utilities.newBlob(bytes, 'image/png', name + '_アイコン.png'));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    props.setProperty('ICON_ID', file.getId());
    if (smallBase64) {
      const sb = Utilities.base64Decode(String(smallBase64));
      if (sb.length > 60 * 1024) throw new Error('アイコン画像が大きすぎます。');
      const small = folder_().createFile(Utilities.newBlob(sb, 'image/jpeg', name + '_アイコン（表示用）.jpg'));
      props.setProperty('ICON_SMALL_ID', small.getId());
    }
  }
  return { name: appName_(), iconUrl: iconData_(), defaultName: APP_NAME, features: appFeatures_() };
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ===== 初期設定（エディタから1回だけ実行） =====
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SHEETS[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PEPPER')) {
    props.setProperty('PEPPER', randomToken_() + randomToken_());
  }
  Logger.log('添付ファイルの保存先フォルダ：' + folder_().getName());
  installDigestTriggers_();
  if (readRows_('Users').length === 0) {
    const inv = createInvite_('admin', 'setup', 7, '初期管理者');
    Logger.log('初期管理者の招待コード：' + inv.code + '（7日間有効）');
  } else {
    Logger.log('シートを確認しました。メンバーはすでに登録されています。');
  }
}

// ===== 認証まわり =====
function api_login(loginId, password) {
  loginId = String(loginId || '').trim().toLowerCase();
  password = String(password || '');
  if (!loginId || !password) throw new Error('ログインIDとパスワードを入力してください。');
  checkThrottle_(loginId);
  const u = readRows_('Users').find(function (r) { return String(r.loginId).toLowerCase() === loginId; });
  if (!u || u.active !== '1' || hashPassword_(password, u.salt) !== u.passHash) {
    addFail_(loginId);
    throw new Error('ログインIDまたはパスワードが違います。');
  }
  clearFail_(loginId);
  u.lastLoginAt = nowIso_();
  updateRow_('Users', u._row, u);
  return { token: createSession_(u.id), user: publicUser_(u) };
}

function api_register(code, loginId, name, password, email) {
  code = String(code || '').trim().toUpperCase().replace(/[\s-]/g, '');
  loginId = String(loginId || '').trim().toLowerCase();
  name = String(name || '').trim();
  password = String(password || '');
  email = String(email || '').trim();

  validateLoginId_(loginId);
  validateName_(name);
  validatePassword_(password);
  validateEmail_(email);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const inv = readRows_('Invites').find(function (r) { return r.code === code; });
    if (!inv) throw new Error('招待コードが正しくありません。');
    if (inv.usedBy) throw new Error('この招待コードはすでに使われています。');
    if (new Date(inv.expiresAt) < new Date()) throw new Error('この招待コードは期限切れです。管理者に新しいコードを依頼してください。');

    const users = readRows_('Users');
    if (users.some(function (r) { return String(r.loginId).toLowerCase() === loginId; })) {
      throw new Error('このログインIDはすでに使われています。別のIDにしてください。');
    }

    const salt = randomToken_().slice(0, 32);
    const now = nowIso_();
    const user = {
      id: 'u_' + randomToken_().slice(0, 16),
      loginId: loginId,
      name: name,
      email: email,
      passHash: hashPassword_(password, salt),
      salt: salt,
      role: inv.role === 'admin' ? 'admin' : 'member',
      territoryAdmin: '0',
      active: '1',
      createdAt: now,
      lastLoginAt: now
    };
    appendRow_('Users', user);

    inv.usedBy = user.id;
    inv.usedAt = now;
    updateRow_('Invites', inv._row, inv);

    return { token: createSession_(user.id), user: publicUser_(user) };
  } finally {
    lock.releaseLock();
  }
}

function api_me(token) {
  return publicUser_(requireUser_(token));
}

function api_logout(token) {
  if (!token) return true;
  CacheService.getScriptCache().remove('s_' + token);
  deleteRows_('Sessions', readRows_('Sessions')
    .filter(function (r) { return r.token === token; })
    .map(function (r) { return r._row; }));
  return true;
}

// ===== 自分のアカウント =====
function api_updateProfile(token, name, email) {
  const u = requireUser_(token);
  name = String(name || '').trim();
  email = String(email || '').trim();
  validateName_(name);
  validateEmail_(email);
  u.name = name;
  u.email = email;
  updateRow_('Users', u._row, u);
  return publicUser_(u);
}

function api_changePassword(token, current, next) {
  const u = requireUser_(token);
  if (hashPassword_(String(current || ''), u.salt) !== u.passHash) {
    throw new Error('現在のパスワードが違います。');
  }
  validatePassword_(String(next || ''));
  u.salt = randomToken_().slice(0, 32);
  u.passHash = hashPassword_(String(next), u.salt);
  updateRow_('Users', u._row, u);
  return true;
}

// 自分で退会する（投稿・コメント・メッセージは「退会したメンバー」として残す）
function api_withdraw(token, password) {
  const u = requireUser_(token);
  if (hashPassword_(String(password || ''), u.salt) !== u.passHash) throw new Error('パスワードが違います。');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const holding = liveTerritories_().filter(function (t) { return isLendable_(t) && t.holderId === u.id; });
    if (holding.length) {
      throw new Error('借りている区域カード（' + holding.map(function (t) { return t.number; }).join('・') + '）を返却してから退会してください。');
    }
    if (u.role === 'admin') {
      const others = readRows_('Users').filter(function (r) { return r.id !== u.id && r.role === 'admin' && r.active === '1'; });
      if (!others.length) throw new Error('全体管理者があなただけのため、退会できません。ほかの人を全体管理者にしてから退会してください。');
    }
    // グループから抜ける（責任者が自分だけなら、ほかのメンバーを責任者に。最後の1人ならグループを削除）
    Object.keys(myGroups_(u)).forEach(function (gid) {
      const rows = groupMemberRows_(gid);
      const m = rows.find(function (r) { return r.userId === u.id; });
      const others = rows.filter(function (r) { return r.userId !== u.id; });
      if (!others.length) {
        deleteGroup_(myGroups_(u)[gid].group);
        return;
      }
      if (m.role === 'leader' && !others.some(function (r) { return r.role === 'leader'; })) {
        others[0].role = 'leader';
        updateRow_('GroupMembers', others[0]._row, others[0]);
      }
      const fresh = groupMemberRows_(gid).find(function (r) { return r.userId === u.id; });
      if (fresh) deleteRows_('GroupMembers', [fresh._row]);
    });
    clearGroupCache_();
    const me = readRows_('Users').find(function (r) { return r.id === u.id; });
    me.active = '0';
    me.email = '';
    me.withdrawnAt = nowIso_();
    // 同じログインIDで登録し直せるよう、IDを空けてパスワードも消す
    me.loginId = 'withdrawn_' + me.id;
    me.passHash = '';
    me.salt = '';
    updateRow_('Users', me._row, me);
    removeSessionsFor_(u.id);
    return true;
  } finally {
    lock.releaseLock();
  }
}

// ===== 管理者：メンバー =====
function api_listMembers(token) {
  requireAdmin_(token);
  // 退会した人は一覧に出さない（戻るときは新しい招待コードで登録し直す）
  return readRows_('Users').filter(function (r) { return !r.withdrawnAt; }).map(adminUser_).sort(function (a, b) {
    return a.name.localeCompare(b.name, 'ja');
  });
}

function api_updateMember(token, userId, changes) {
  const me = requireAdmin_(token);
  changes = changes || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const users = readRows_('Users');
    const u = users.find(function (r) { return r.id === userId && !r.withdrawnAt; });
    if (!u) throw new Error('メンバーが見つかりません。');

    if (changes.role !== undefined) {
      const role = changes.role === 'admin' ? 'admin' : 'member';
      if (u.id === me.id && role !== 'admin') throw new Error('自分自身の管理者権限は外せません。');
      u.role = role;
    }
    if (changes.territoryAdmin !== undefined) {
      u.territoryAdmin = changes.territoryAdmin ? '1' : '0';
    }
    if (changes.calendarEditor !== undefined) {
      u.calendarEditor = changes.calendarEditor ? '1' : '0';
    }
    if (changes.active !== undefined) {
      if (u.id === me.id && !changes.active) throw new Error('自分自身は利用停止にできません。');
      u.active = changes.active ? '1' : '0';
    }

    const admins = users.filter(function (r) {
      const x = r.id === u.id ? u : r;
      return x.role === 'admin' && x.active === '1';
    });
    if (admins.length === 0) throw new Error('全体管理者が1人もいなくなるため、変更できません。');

    updateRow_('Users', u._row, u);
    if (u.active !== '1') removeSessionsFor_(u.id);
    return adminUser_(u);
  } finally {
    lock.releaseLock();
  }
}

function api_resetPassword(token, userId) {
  requireAdmin_(token);
  const u = readRows_('Users').find(function (r) { return r.id === userId; });
  if (!u) throw new Error('メンバーが見つかりません。');
  const temp = randomCode_(10);
  u.salt = randomToken_().slice(0, 32);
  u.passHash = hashPassword_(temp, u.salt);
  updateRow_('Users', u._row, u);
  removeSessionsFor_(u.id);
  return { name: u.name, loginId: u.loginId, tempPassword: temp };
}

// ===== 管理者：招待コード =====
function api_createInvite(token, role, days, note) {
  const me = requireAdmin_(token);
  days = Math.max(1, Math.min(90, Number(days) || 14));
  note = String(note || '').trim().slice(0, 40);
  const inv = createInvite_(role === 'admin' ? 'admin' : 'member', me.id, days, note);
  return { code: inv.code, role: inv.role, expiresAt: inv.expiresAt, note: inv.note, url: ScriptApp.getService().getUrl() };
}

function api_listInvites(token) {
  requireAdmin_(token);
  const names = {};
  readRows_('Users').forEach(function (u) { names[u.id] = u.name; });
  const now = new Date();
  return readRows_('Invites').map(function (r) {
    let status = 'open';
    if (r.usedBy) status = 'used';
    else if (new Date(r.expiresAt) < now) status = 'expired';
    return {
      code: r.code, role: r.role, note: r.note, createdAt: r.createdAt, expiresAt: r.expiresAt,
      usedAt: r.usedAt, usedByName: names[r.usedBy] || '', status: status
    };
  }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }).slice(0, 50);
}

function api_revokeInvite(token, code) {
  requireAdmin_(token);
  const inv = readRows_('Invites').find(function (r) { return r.code === code; });
  if (!inv) throw new Error('招待コードが見つかりません。');
  if (inv.usedBy) throw new Error('使用済みのコードは取り消せません。');
  inv.expiresAt = nowIso_();
  updateRow_('Invites', inv._row, inv);
  return true;
}

// ===== 起動時（ログイン確認＋ホームの情報を1回の通信で） =====
function api_bootstrap(token, today) {
  const u = requireUser_(token);
  return { user: publicUser_(u), summary: summary_(u, today) };
}

// ===== 掲示板・お知らせ =====
function api_homeSummary(token, today) {
  return summary_(requireUser_(token), today);
}

function isGlobalPost_(p) {
  return !p.groupId;
}

// 未読数：board＝全体の掲示板、notice＝お知らせ、group＝自分のグループの掲示板
function unreadCounts_(u, posts, readSet, myGroups) {
  const unread = { board: 0, notice: 0, group: 0 };
  posts.forEach(function (p) {
    if (p.authorId === u.id || readSet[p.id]) return;
    if (p.groupId) {
      const g = myGroups && myGroups[p.groupId];
      if (g && hasFeature_(g.group, 'board')) unread.group++;
      return;
    }
    unread[p.type] = (unread[p.type] || 0) + 1;
  });
  return unread;
}

// 掲示板に投稿できるグループ
function boardGroups_(myGroups) {
  return Object.keys(myGroups).filter(function (gid) {
    return hasFeature_(myGroups[gid].group, 'board');
  }).map(function (gid) {
    return { id: gid, name: myGroups[gid].group.name };
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
}

function summary_(u, today) {
  if (!isDate_(today)) today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const posts = livePosts_();
  const readSet = readSetFor_(u.id);
  const names = userNames_();
  const myGroups = myGroups_(u);
  const unread = unreadCounts_(u, posts, readSet, myGroups);
  const notices = posts.filter(function (p) { return p.type === 'notice' && !p.groupId; }).slice(0, 3).map(function (p) {
    return {
      id: p.id, title: p.title, important: p.important === '1', createdAt: p.createdAt,
      authorName: names[p.authorId] || '（退会したメンバー）',
      isRead: p.authorId === u.id || !!readSet[p.id]
    };
  });
  const upcoming = visibleEvents_(u, myGroups, today, shiftDate_(today, 6), '').slice(0, 5);
  const chatUnread = chatUnreadByConv_(u, myConvIds_(u, myGroups));
  let chatTotal = 0;
  Object.keys(chatUnread).forEach(function (k) { chatTotal += chatUnread[k]; });
  return {
    unread: unread, notices: notices, upcoming: upcoming,
    chatUnread: chatTotal, groupCount: Object.keys(myGroups).length,
    territory: terrSummary_(u)
  };
}

// 投稿を見られるか（グループの投稿はメンバーだけ）
function postAccess_(u, p, myGroups) {
  if (!p.groupId) return { moderator: u.role === 'admin' };
  const g = myGroups[p.groupId];
  if (!g || !hasFeature_(g.group, 'board')) return null;
  return { moderator: g.role === 'leader' };
}

function findPostFor_(u, postId, myGroups) {
  const p = livePosts_().find(function (r) { return r.id === postId; });
  const access = p ? postAccess_(u, p, myGroups) : null;
  if (!p || !access) throw new Error('投稿が見つかりません。削除された可能性があります。');
  return { post: p, access: access };
}

function api_listPosts(token, type, groupId) {
  const u = requireUser_(token);
  requireFeature_('board');
  groupId = String(groupId || '');
  const myGroups = myGroups_(u);
  if (groupId) {
    requireGroupMember_(u, groupId, 'board');
    type = 'board';
  } else if (type !== 'groups') {
    type = type === 'notice' ? 'notice' : 'board';
  }
  // type が groups のときは、自分の全グループの投稿をまとめて返す
  const inScope = type === 'groups'
    ? function (p) { const g = p.groupId && myGroups[p.groupId]; return !!(g && hasFeature_(g.group, 'board')); }
    : function (p) { return (p.groupId || '') === groupId && p.type === type; };
  const names = userNames_();
  const readSet = readSetFor_(u.id);
  const readCounts = readCounts_();
  const commentCounts = countBy_(readRows_('Comments').filter(function (c) { return c.deleted !== '1'; }), 'postId');
  const filesMap = filesByOwner_();
  const all = livePosts_();
  const posts = all.filter(inScope).slice(0, 100).map(function (p) {
    const v = postView_(p, u, names, readSet, readCounts, commentCounts, filesMap, postAccess_(u, p, myGroups));
    v.groupName = p.groupId && myGroups[p.groupId] ? myGroups[p.groupId].group.name : '';
    return v;
  });
  return { posts: posts, unread: unreadCounts_(u, all, readSet, myGroups), boardGroups: boardGroups_(myGroups) };
}

function api_getPost(token, postId) {
  const u = requireUser_(token);
  requireFeature_('board');
  const myGroups = myGroups_(u);
  const found = findPostFor_(u, postId, myGroups);
  const p = found.post;
  const readSet = readSetFor_(u.id);
  if (p.authorId !== u.id && !readSet[p.id]) {
    markRead_(p.id, u.id);
    readSet[p.id] = true;
  }
  const names = userNames_();
  const filesMap = filesByOwner_();
  const comments = commentsFor_(p.id, u, names, filesMap, found.access);
  const commentCounts = {};
  commentCounts[p.id] = comments.length;
  const view = postView_(p, u, names, readSet, readCounts_(), commentCounts, filesMap, found.access);
  view.groupName = p.groupId && myGroups[p.groupId] ? myGroups[p.groupId].group.name : '';
  return {
    post: view,
    comments: comments,
    unread: unreadCounts_(u, livePosts_(), readSet, myGroups)
  };
}

function api_createPost(token, type, title, body, important, sendMail, fileIds, groupId) {
  const u = requireUser_(token);
  requireFeature_('board');
  groupId = String(groupId || '');
  if (groupId) {
    requireGroupMember_(u, groupId, 'board');
    type = 'board';
  } else {
    type = type === 'notice' ? 'notice' : 'board';
    if (type === 'notice' && u.role !== 'admin') throw new Error('お知らせは全体管理者のみ投稿できます。');
  }
  title = String(title || '').trim();
  body = String(body || '').trim();
  validatePost_(title, body);
  const now = nowIso_();
  const p = {
    id: 'p_' + randomToken_().slice(0, 16),
    type: type,
    title: title,
    body: body,
    authorId: u.id,
    important: type === 'notice' && important ? '1' : '0',
    createdAt: now,
    updatedAt: now,
    deleted: '',
    groupId: groupId
  };
  attachFiles_(u, fileIds, 'post', p.id);
  appendRow_('Posts', p);
  let mail = null;
  if (type === 'notice' && sendMail) mail = sendNoticeMail_(p, u);
  return { id: p.id, mail: mail };
}

function api_updatePost(token, postId, title, body, important, fileIds) {
  const u = requireUser_(token);
  requireFeature_('board');
  const p = findPostFor_(u, postId, myGroups_(u)).post;
  if (p.authorId !== u.id) throw new Error('自分の投稿のみ編集できます。');
  title = String(title || '').trim();
  body = String(body || '').trim();
  validatePost_(title, body);
  p.title = title;
  p.body = body;
  if (p.type === 'notice') p.important = important ? '1' : '0';
  if (Array.isArray(fileIds)) {
    attachFiles_(u, fileIds, 'post', p.id);
    deleteFilesFor_('post', p.id, fileIds);
  }
  p.updatedAt = nowIso_();
  updateRow_('Posts', p._row, p);
  return true;
}

function api_deletePost(token, postId) {
  const u = requireUser_(token);
  const found = findPostFor_(u, postId, myGroups_(u));
  const p = found.post;
  if (p.authorId !== u.id && !found.access.moderator) throw new Error('この投稿は削除できません。');
  p.deleted = '1';
  p.updatedAt = nowIso_();
  updateRow_('Posts', p._row, p);
  deleteFilesFor_('post', p.id, []);
  readRows_('Comments').forEach(function (c) {
    if (c.postId === p.id) deleteFilesFor_('comment', c.id, []);
  });
  return true;
}

function api_addComment(token, postId, body, fileIds) {
  const u = requireUser_(token);
  requireFeature_('board');
  const found = findPostFor_(u, postId, myGroups_(u));
  const p = found.post;
  body = String(body || '').trim();
  const hasFiles = Array.isArray(fileIds) && fileIds.length > 0;
  if (!body && !hasFiles) throw new Error('コメントを入力するか、ファイルを添付してください。');
  if (body.length > 1000) throw new Error('コメントは1000文字以内にしてください。');
  const id = 'c_' + randomToken_().slice(0, 16);
  attachFiles_(u, fileIds, 'comment', id);
  appendRow_('Comments', {
    id: id,
    postId: p.id,
    authorId: u.id,
    body: body,
    createdAt: nowIso_(),
    deleted: ''
  });
  return commentsFor_(p.id, u, userNames_(), filesByOwner_(), found.access);
}

function api_deleteComment(token, commentId) {
  const u = requireUser_(token);
  const c = readRows_('Comments').find(function (r) { return r.id === commentId && r.deleted !== '1'; });
  if (!c) throw new Error('コメントが見つかりません。');
  const found = findPostFor_(u, c.postId, myGroups_(u));
  if (c.authorId !== u.id && !found.access.moderator) throw new Error('このコメントは削除できません。');
  c.deleted = '1';
  updateRow_('Comments', c._row, c);
  deleteFilesFor_('comment', c.id, []);
  return commentsFor_(c.postId, u, userNames_(), filesByOwner_(), found.access);
}

// ===== グループ =====
function hasFeature_(g, f) {
  if (!featureOn_(f)) return false;   // アプリ全体でオフの機能は、グループでも使えない
  return String(g.features || '').split(',').indexOf(f) >= 0;
}

// 自分が入っているグループ：groupId → { group, role }
const myGroupsCache_ = {};
function myGroups_(u) {
  if (!featureOn_('groups')) return {};
  if (myGroupsCache_[u.id]) return myGroupsCache_[u.id];
  const groups = {};
  readRows_('Groups').forEach(function (g) { if (g.deleted !== '1') groups[g.id] = g; });
  const out = {};
  readRows_('GroupMembers').forEach(function (m) {
    if (m.userId === u.id && groups[m.groupId]) out[m.groupId] = { group: groups[m.groupId], role: m.role };
  });
  myGroupsCache_[u.id] = out;
  return out;
}
function clearGroupCache_() {
  Object.keys(myGroupsCache_).forEach(function (k) { delete myGroupsCache_[k]; });
}

function requireGroupMember_(u, gid, feature) {
  const g = myGroups_(u)[gid];
  if (!g) throw new Error('グループが見つかりません。');
  if (feature && !hasFeature_(g.group, feature)) throw new Error('この機能は、このグループではオフになっています。');
  return g;
}

function requireGroupLeader_(u, gid) {
  const g = requireGroupMember_(u, gid);
  if (g.role !== 'leader') throw new Error('この操作はグループ責任者のみ行えます。');
  return g;
}

function groupMemberRows_(gid) {
  return readRows_('GroupMembers').filter(function (m) { return m.groupId === gid; });
}

function activeUsers_() {
  const map = {};
  readRows_('Users').forEach(function (r) { if (r.active === '1') map[r.id] = r; });
  return map;
}

function cleanGroup_(name, description, features) {
  name = String(name || '').trim();
  description = String(description || '').trim();
  if (!name || name.length > 30) throw new Error('グループ名は1〜30文字で入力してください。');
  if (description.length > 200) throw new Error('説明は200文字以内にしてください。');
  const list = (Array.isArray(features) ? features : []).filter(function (f, i, a) {
    return GROUP_FEATURES.indexOf(f) >= 0 && a.indexOf(f) === i;
  });
  return { name: name, description: description, features: list.join(',') };
}

function groupView_(g, role, memberCount) {
  return {
    id: g.id, name: g.name, description: g.description,
    features: g.features ? g.features.split(',') : [],
    isLeader: role === 'leader', memberCount: memberCount
  };
}

function api_listUsers(token) {
  const u = requireUser_(token);
  const users = activeUsers_();
  return Object.keys(users).map(function (id) {
    return { id: id, name: users[id].name, isMe: id === u.id };
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
}

function api_listGroups(token) {
  const u = requireUser_(token);
  requireFeature_('groups');
  const myGroups = myGroups_(u);
  const counts = countBy_(readRows_('GroupMembers'), 'groupId');
  const readSet = readSetFor_(u.id);
  const boardUnread = {};
  livePosts_().forEach(function (p) {
    if (p.groupId && myGroups[p.groupId] && p.authorId !== u.id && !readSet[p.id]) {
      boardUnread[p.groupId] = (boardUnread[p.groupId] || 0) + 1;
    }
  });
  const chatUnread = chatUnreadByConv_(u, myConvIds_(u, myGroups));
  return Object.keys(myGroups).map(function (gid) {
    const g = myGroups[gid];
    const v = groupView_(g.group, g.role, counts[gid] || 0);
    v.boardUnread = hasFeature_(g.group, 'board') ? (boardUnread[gid] || 0) : 0;
    v.chatUnread = hasFeature_(g.group, 'chat') ? (chatUnread['g_' + gid] || 0) : 0;
    return v;
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
}

function api_getGroup(token, gid) {
  const u = requireUser_(token);
  const g = requireGroupMember_(u, gid);
  const users = activeUsers_();
  const names = userNames_();
  const members = groupMemberRows_(gid).map(function (m) {
    return {
      id: m.userId, name: names[m.userId] || '（退会したメンバー）', role: m.role,
      isMe: m.userId === u.id, active: !!users[m.userId]
    };
  }).sort(function (a, b) {
    if (a.role !== b.role) return a.role === 'leader' ? -1 : 1;
    return a.name.localeCompare(b.name, 'ja');
  });
  return { group: groupView_(g.group, g.role, members.length), members: members };
}

function api_createGroup(token, name, description, features, memberIds) {
  const u = requireUser_(token);
  requireFeature_('groups');
  const v = cleanGroup_(name, description, features);
  const users = activeUsers_();
  const now = nowIso_();
  const gid = 'g' + randomToken_().slice(0, 15);
  appendRow_('Groups', {
    id: gid, name: v.name, description: v.description, features: v.features,
    createdBy: u.id, createdAt: now, updatedAt: now, deleted: ''
  });
  appendRow_('GroupMembers', { groupId: gid, userId: u.id, role: 'leader', joinedAt: now });
  addMembers_(gid, memberIds, users, [u.id]);
  clearGroupCache_();
  return gid;
}

function addMembers_(gid, memberIds, users, existing) {
  const ids = (Array.isArray(memberIds) ? memberIds : []).filter(function (id, i, a) {
    return users[id] && existing.indexOf(id) < 0 && a.indexOf(id) === i;
  });
  if (ids.length > 200) throw new Error('一度に追加できるのは200人までです。');
  if (!ids.length) return 0;
  const now = nowIso_();
  const sh = sheet_('GroupMembers');
  sh.getRange(sh.getLastRow() + 1, 1, ids.length, 4).setValues(ids.map(function (id) {
    return [cell_(gid), cell_(id), cell_('member'), cell_(now)];
  }));
  delete rowsCache_.GroupMembers;
  return ids.length;
}

function api_updateGroup(token, gid, name, description, features) {
  const u = requireUser_(token);
  const g = requireGroupLeader_(u, gid).group;
  const v = cleanGroup_(name, description, features);
  g.name = v.name;
  g.description = v.description;
  g.features = v.features;
  g.updatedAt = nowIso_();
  updateRow_('Groups', g._row, g);
  clearGroupCache_();
  return true;
}

function api_addGroupMembers(token, gid, userIds) {
  const u = requireUser_(token);
  requireGroupLeader_(u, gid);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const existing = groupMemberRows_(gid).map(function (m) { return m.userId; });
    const n = addMembers_(gid, userIds, activeUsers_(), existing);
    clearGroupCache_();
    return n;
  } finally {
    lock.releaseLock();
  }
}

function api_setGroupRole(token, gid, userId, role) {
  const u = requireUser_(token);
  requireGroupLeader_(u, gid);
  role = role === 'leader' ? 'leader' : 'member';
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const rows = groupMemberRows_(gid);
    const m = rows.find(function (r) { return r.userId === userId; });
    if (!m) throw new Error('メンバーが見つかりません。');
    if (role === 'member') {
      const leaders = rows.filter(function (r) { return r.role === 'leader' && r.userId !== userId; });
      if (!leaders.length) throw new Error('グループ責任者が1人もいなくなるため、変更できません。');
    }
    m.role = role;
    updateRow_('GroupMembers', m._row, m);
    clearGroupCache_();
    return true;
  } finally {
    lock.releaseLock();
  }
}

// 自分が抜ける、または責任者がメンバーを外す
function api_removeGroupMember(token, gid, userId) {
  const u = requireUser_(token);
  const me = requireGroupMember_(u, gid);
  if (userId !== u.id && me.role !== 'leader') throw new Error('この操作はグループ責任者のみ行えます。');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const rows = groupMemberRows_(gid);
    const m = rows.find(function (r) { return r.userId === userId; });
    if (!m) throw new Error('メンバーが見つかりません。');
    const others = rows.filter(function (r) { return r.userId !== userId; });
    if (!others.length) {
      // 最後の1人が抜けたらグループを削除
      deleteGroup_(me.group);
    } else if (m.role === 'leader' && !others.some(function (r) { return r.role === 'leader'; })) {
      throw new Error('ほかのメンバーを責任者にしてから抜けてください。');
    }
    deleteRows_('GroupMembers', [m._row]);
    clearGroupCache_();
    return true;
  } finally {
    lock.releaseLock();
  }
}

function api_deleteGroup(token, gid) {
  const u = requireUser_(token);
  const g = requireGroupLeader_(u, gid).group;
  deleteGroup_(g);
  clearGroupCache_();
  return true;
}

function deleteGroup_(g) {
  g.deleted = '1';
  g.updatedAt = nowIso_();
  updateRow_('Groups', g._row, g);
}

// ===== メッセージ =====
// トーク（会話）のID：グループは "g_グループID"、1対1は DmPairs の id
function myConvIds_(u, myGroups) {
  if (!featureOn_('chat')) return [];
  const ids = Object.keys(myGroups).filter(function (gid) {
    return hasFeature_(myGroups[gid].group, 'chat');
  }).map(function (gid) { return 'g_' + gid; });
  readRows_('DmPairs').forEach(function (p) {
    if (p.userA === u.id || p.userB === u.id) ids.push(p.id);
  });
  return ids;
}

function convAccess_(u, convId, myGroups) {
  convId = String(convId || '');
  if (convId.indexOf('g_') === 0) {
    const gid = convId.slice(2);
    const g = myGroups[gid];
    if (!g || !hasFeature_(g.group, 'chat')) throw new Error('トークが見つかりません。');
    return {
      id: convId, type: 'group', groupId: gid, title: g.group.name,
      memberIds: groupMemberRows_(gid).map(function (m) { return m.userId; })
    };
  }
  const pair = readRows_('DmPairs').find(function (p) { return p.id === convId; });
  if (!pair || (pair.userA !== u.id && pair.userB !== u.id)) throw new Error('トークが見つかりません。');
  const other = pair.userA === u.id ? pair.userB : pair.userA;
  return {
    id: convId, type: 'dm', otherId: other, title: userNames_()[other] || '（退会したメンバー）',
    memberIds: [pair.userA, pair.userB]
  };
}

function liveMessages_() {
  return readRows_('Messages').filter(function (m) { return m.deleted !== '1'; });
}

function chatReads_() {
  const map = {};   // convId → { userId → { _row, lastReadAt } }
  readRows_('ChatReads').forEach(function (r) {
    (map[r.convId] = map[r.convId] || {})[r.userId] = r;
  });
  return map;
}

function chatUnreadByConv_(u, convIds) {
  const out = {};
  if (!convIds.length) return out;
  const set = {};
  convIds.forEach(function (id) { set[id] = true; out[id] = 0; });
  const reads = chatReads_();
  liveMessages_().forEach(function (m) {
    if (!set[m.convId] || m.authorId === u.id) return;
    const r = reads[m.convId] && reads[m.convId][u.id];
    if (!r || m.createdAt > r.lastReadAt) out[m.convId]++;
  });
  return out;
}

// 変更があったときだけ読み込むための「版」（キャッシュに保存）
function chatVersion_(convId) {
  const c = CacheService.getScriptCache();
  let v = c.get('cv_' + convId);
  if (!v) {
    v = nowIso_() + '_' + randomCode_(4);
    c.put('cv_' + convId, v, 21600);
  }
  return v;
}
function bumpChat_(convId) {
  CacheService.getScriptCache().put('cv_' + convId, nowIso_() + '_' + randomCode_(4), 21600);
}

function markChatRead_(u, convId, msgs) {
  let latest = '';
  msgs.forEach(function (m) { if (m.authorId !== u.id && m.createdAt > latest) latest = m.createdAt; });
  if (!latest) return false;
  const r = (chatReads_()[convId] || {})[u.id];
  if (r && r.lastReadAt >= latest) return false;
  const now = nowIso_();
  if (r) {
    r.lastReadAt = now;
    updateRow_('ChatReads', r._row, r);
  } else {
    appendRow_('ChatReads', { convId: convId, userId: u.id, lastReadAt: now });
  }
  bumpChat_(convId);
  return true;
}

function chatView_(u, access) {
  const names = userNames_();
  const filesMap = filesByOwner_();
  const all = liveMessages_().filter(function (m) { return m.convId === access.id; })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0; });
  markChatRead_(u, access.id, all);
  const expired = expiredChatFiles_();
  const reads = chatReads_()[access.id] || {};
  const msgs = all.slice(-CHAT_PAGE).map(function (m) {
    let readCount = 0;
    access.memberIds.forEach(function (id) {
      if (id === m.authorId) return;
      const r = reads[id];
      if (r && r.lastReadAt >= m.createdAt) readCount++;
    });
    return {
      id: m.id, body: m.body, createdAt: m.createdAt, mine: m.authorId === u.id,
      authorName: names[m.authorId] || '（退会したメンバー）',
      files: filesMap['message:' + m.id] || [],
      expiredFiles: expired[m.id] || 0,
      readCount: readCount
    };
  });
  return {
    conv: { id: access.id, type: access.type, title: access.title, groupId: access.groupId || '', memberCount: access.memberIds.length },
    messages: msgs,
    hasMore: all.length > CHAT_PAGE,
    version: chatVersion_(access.id)
  };
}

function api_inbox(token) {
  const u = requireUser_(token);
  requireFeature_('chat');
  const myGroups = myGroups_(u);
  const names = userNames_();
  const convIds = myConvIds_(u, myGroups);
  const unread = chatUnreadByConv_(u, convIds);
  const last = {};
  liveMessages_().forEach(function (m) {
    if (unread[m.convId] === undefined) return;
    if (!last[m.convId] || m.createdAt > last[m.convId].createdAt) last[m.convId] = m;
  });
  const pairs = {};
  readRows_('DmPairs').forEach(function (p) { pairs[p.id] = p; });
  const list = convIds.map(function (id) {
    let title;
    let type;
    if (id.indexOf('g_') === 0) {
      type = 'group';
      title = myGroups[id.slice(2)].group.name;
    } else {
      type = 'dm';
      const p = pairs[id];
      title = names[p.userA === u.id ? p.userB : p.userA] || '（退会したメンバー）';
    }
    const m = last[id];
    return {
      id: id, type: type, title: title, unread: unread[id] || 0,
      lastAt: m ? m.createdAt : '',
      lastText: m ? ((m.authorId === u.id ? 'あなた：' : (type === 'group' ? (names[m.authorId] || '') + '：' : '')) + (m.body || '（ファイル）')).slice(0, 60) : ''
    };
  }).filter(function (c) { return c.type === 'group' || c.lastAt; })
    .sort(function (a, b) { return a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : a.title.localeCompare(b.title, 'ja'); });
  return list;
}

function api_openDm(token, otherId) {
  const u = requireUser_(token);
  requireFeature_('chat');
  if (otherId === u.id) throw new Error('自分にはメッセージを送れません。');
  if (!activeUsers_()[otherId]) throw new Error('メンバーが見つかりません。');
  const a = u.id < otherId ? u.id : otherId;
  const b = u.id < otherId ? otherId : u.id;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const found = readRows_('DmPairs').find(function (p) { return p.userA === a && p.userB === b; });
    if (found) return found.id;
    const id = 'd' + randomToken_().slice(0, 15);
    appendRow_('DmPairs', { id: id, userA: a, userB: b, createdAt: nowIso_() });
    return id;
  } finally {
    lock.releaseLock();
  }
}

function api_getChat(token, convId) {
  const u = requireUser_(token);
  requireFeature_('chat');
  return chatView_(u, convAccess_(u, convId, myGroups_(u)));
}

// 自動更新：変更がなければシートを読まずにすぐ返す
function api_pollChat(token, convId, version) {
  const u = requireUser_(token);
  requireFeature_('chat');
  const v = CacheService.getScriptCache().get('cv_' + convId);
  if (v && version && v === version) return { changed: false };
  const r = chatView_(u, convAccess_(u, convId, myGroups_(u)));
  r.changed = true;
  return r;
}

function api_sendMessage(token, convId, body, fileIds) {
  const u = requireUser_(token);
  requireFeature_('chat');
  const access = convAccess_(u, convId, myGroups_(u));
  if (access.type === 'dm' && !activeUsers_()[access.otherId]) throw new Error('相手のメンバーが利用停止中のため、送信できません。');
  body = String(body || '').trim();
  const hasFiles = Array.isArray(fileIds) && fileIds.length > 0;
  if (!body && !hasFiles) throw new Error('メッセージを入力するか、ファイルを添付してください。');
  if (body.length > 2000) throw new Error('メッセージは2000文字以内にしてください。');
  const id = 'm_' + randomToken_().slice(0, 16);
  attachFiles_(u, fileIds, 'message', id);
  appendRow_('Messages', { id: id, convId: access.id, authorId: u.id, body: body, createdAt: nowIso_(), deleted: '' });
  bumpChat_(access.id);
  return chatView_(u, access);
}

function api_deleteMessage(token, messageId) {
  const u = requireUser_(token);
  const m = liveMessages_().find(function (r) { return r.id === messageId; });
  if (!m) throw new Error('メッセージが見つかりません。');
  const access = convAccess_(u, m.convId, myGroups_(u));
  if (m.authorId !== u.id) throw new Error('自分のメッセージのみ削除できます。');
  m.deleted = '1';
  updateRow_('Messages', m._row, m);
  deleteFilesFor_('message', m.id, []);
  bumpChat_(access.id);
  return chatView_(u, access);
}

// ===== 添付ファイル =====
function api_uploadFile(token, name, mime, base64) {
  const u = requireUser_(token);
  name = String(name || 'file').replace(/[\\\/:*?"<>|]/g, '_').slice(0, 80);
  mime = String(mime || '');
  if (ALLOWED_MIME.indexOf(mime) < 0) throw new Error('添付できるのは画像（JPG・PNG）とPDFだけです。');
  const bytes = Utilities.base64Decode(String(base64 || ''));
  if (!bytes.length) throw new Error('ファイルが空です。');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('ファイルが大きすぎます（5MBまで）。');
  const pending = readRows_('Files').filter(function (f) {
    return f.uploadedBy === u.id && !f.ownerId && f.deleted !== '1';
  });
  if (pending.length >= 20) throw new Error('未投稿の添付ファイルが多すぎます。いったん投稿するか、時間をおいてお試しください。');

  const file = folder_().createFile(Utilities.newBlob(bytes, mime, name));
  const rec = {
    id: 'f_' + randomToken_().slice(0, 16),
    driveId: file.getId(),
    ownerType: '',
    ownerId: '',
    name: name,
    mime: mime,
    size: String(bytes.length),
    uploadedBy: u.id,
    createdAt: nowIso_(),
    deleted: ''
  };
  appendRow_('Files', rec);
  if (Math.random() < 0.1) cleanupPendingFiles_();
  return fileView_(rec);
}

function api_getFile(token, fileId) {
  const u = requireUser_(token);
  const f = readRows_('Files').find(function (r) { return r.id === fileId && r.deleted !== '1'; });
  if (!f) throw new Error('ファイルが見つかりません。');
  // 添付先（投稿・コメント・メッセージ）を見られる人だけが開ける
  const notFound = function () { throw new Error('ファイルが見つかりません。'); };
  if (!f.ownerId) {
    if (f.uploadedBy !== u.id) notFound();
  } else {
    const myGroups = myGroups_(u);
    try {
      if (f.ownerType === 'post') {
        findPostFor_(u, f.ownerId, myGroups);
      } else if (f.ownerType === 'comment') {
        const c = readRows_('Comments').find(function (r) { return r.id === f.ownerId && r.deleted !== '1'; });
        if (!c) notFound();
        findPostFor_(u, c.postId, myGroups);
      } else if (f.ownerType === 'territory') {
        findTerritoryFor_(u, f.ownerId);
      } else if (f.ownerType === 'message') {
        const m = liveMessages_().find(function (r) { return r.id === f.ownerId; });
        if (!m) notFound();
        convAccess_(u, m.convId, myGroups);
      } else {
        notFound();
      }
    } catch (e) {
      notFound();
    }
  }
  const blob = DriveApp.getFileById(f.driveId).getBlob();
  return { id: f.id, name: f.name, mime: f.mime, data: Utilities.base64Encode(blob.getBytes()) };
}

function attachFiles_(u, fileIds, ownerType, ownerId) {
  if (!Array.isArray(fileIds) || !fileIds.length) return;
  if (fileIds.length > MAX_FILES) throw new Error('添付は' + MAX_FILES + 'ファイルまでです。');
  const files = readRows_('Files');
  const targets = [];
  fileIds.forEach(function (id) {
    const f = files.find(function (r) { return r.id === id && r.deleted !== '1'; });
    if (!f) throw new Error('添付ファイルが見つかりません。もう一度添付してください。');
    if (f.ownerId) {
      if (f.ownerType === ownerType && f.ownerId === ownerId) return; // すでに添付済み
      throw new Error('添付ファイルが正しくありません。');
    }
    if (f.uploadedBy !== u.id) throw new Error('添付ファイルが正しくありません。');
    targets.push(f);
  });
  targets.forEach(function (f) {
    f.ownerType = ownerType;
    f.ownerId = ownerId;
    updateRow_('Files', f._row, f);
  });
}

// keepIds に含まれないファイルを削除（ごみ箱へ）
function deleteFilesFor_(ownerType, ownerId, keepIds) {
  readRows_('Files').forEach(function (f) {
    if (f.ownerType === ownerType && f.ownerId === ownerId && f.deleted !== '1' && keepIds.indexOf(f.id) < 0) {
      trashFile_(f);
    }
  });
}

function trashFile_(f) {
  f.deleted = '1';
  updateRow_('Files', f._row, f);
  try { DriveApp.getFileById(f.driveId).setTrashed(true); } catch (e) { /* すでに無い場合は無視 */ }
}

// 投稿されずに1日以上たった添付ファイルを片付ける
function cleanupPendingFiles_() {
  const limit = new Date(Date.now() - 86400000);
  readRows_('Files').forEach(function (f) {
    if (!f.ownerId && f.deleted !== '1' && new Date(f.createdAt) < limit) trashFile_(f);
  });
}

// 保存期間を過ぎて削除したメッセージの添付ファイルの数：messageId → 件数
function expiredChatFiles_() {
  const map = {};
  readRows_('Files').forEach(function (f) {
    if (f.expired === '1' && f.ownerType === 'message') map[f.ownerId] = (map[f.ownerId] || 0) + 1;
  });
  return map;
}

// メッセージの添付ファイルのうち、保存期間を過ぎたものを削除（毎朝の自動実行で呼ばれる）
function cleanupChatFiles_() {
  const limit = new Date();
  limit.setMonth(limit.getMonth() - CHAT_FILE_KEEP_MONTHS);
  const cut = limit.toISOString();
  let n = 0;
  readRows_('Files').some(function (f) {
    if (f.ownerType !== 'message' || f.deleted === '1' || !f.createdAt || f.createdAt >= cut) return false;
    f.expired = '1';
    trashFile_(f);
    n++;
    return n >= 300;   // 1回の処理時間を抑える（残りは翌日）
  });
  if (n) Logger.log('保存期間を過ぎたメッセージの添付ファイルを' + n + '件削除しました。');
  return n;
}

// エディタから手動で片付けたいとき用
function runCleanup() {
  cleanupPendingFiles_();
  return cleanupChatFiles_();
}

function filesByOwner_() {
  const map = {};
  readRows_('Files').forEach(function (f) {
    if (f.deleted === '1' || !f.ownerId) return;
    const k = f.ownerType + ':' + f.ownerId;
    (map[k] = map[k] || []).push(fileView_(f));
  });
  return map;
}

function fileView_(f) {
  return { id: f.id, name: f.name, mime: f.mime, size: Number(f.size) || 0 };
}

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 作り直す */ }
  }
  const folder = DriveApp.createFolder(APP_NAME + '_添付ファイル');
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function validatePost_(title, body) {
  if (!title || title.length > 60) throw new Error('タイトルは1〜60文字で入力してください。');
  if (!body || body.length > 3000) throw new Error('本文は1〜3000文字で入力してください。');
}

function livePosts_() {
  if (!featureOn_('board')) return [];
  return readRows_('Posts').filter(function (p) { return p.deleted !== '1'; })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
}

function postView_(p, u, names, readSet, readCounts, commentCounts, filesMap, access) {
  const mine = p.authorId === u.id;
  return {
    files: (filesMap && filesMap['post:' + p.id]) || [],
    id: p.id, type: p.type, title: p.title, body: p.body, groupId: p.groupId || '',
    authorName: names[p.authorId] || '（退会したメンバー）',
    important: p.important === '1',
    createdAt: p.createdAt,
    edited: p.updatedAt && p.updatedAt !== p.createdAt,
    readCount: readCounts[p.id] || 0,
    commentCount: commentCounts[p.id] || 0,
    isRead: mine || !!readSet[p.id],
    canEdit: mine,
    canDelete: mine || !!(access && access.moderator)
  };
}

function commentsFor_(postId, u, names, filesMap, access) {
  return readRows_('Comments').filter(function (c) { return c.postId === postId && c.deleted !== '1'; })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; })
    .map(function (c) {
      return {
        id: c.id, body: c.body, createdAt: c.createdAt,
        files: (filesMap && filesMap['comment:' + c.id]) || [],
        authorName: names[c.authorId] || '（退会したメンバー）',
        canDelete: c.authorId === u.id || !!(access && access.moderator)
      };
    });
}

function userNames_() {
  const names = {};
  readRows_('Users').forEach(function (r) { names[r.id] = r.withdrawnAt ? '（退会したメンバー）' : r.name; });
  return names;
}

// 既読記録：postId → { _row, ids: [userId...] }
function readMarks_() {
  migrateReads_();
  const map = {};
  readRows_('ReadMarks').forEach(function (r) {
    map[r.postId] = { _row: r._row, ids: r.userIds ? r.userIds.split(',') : [] };
  });
  return map;
}

function readSetFor_(userId) {
  const set = {};
  const marks = readMarks_();
  Object.keys(marks).forEach(function (pid) {
    if (marks[pid].ids.indexOf(userId) >= 0) set[pid] = true;
  });
  return set;
}

function readCounts_() {
  const counts = {};
  const marks = readMarks_();
  Object.keys(marks).forEach(function (pid) { counts[pid] = marks[pid].ids.length; });
  return counts;
}

function markRead_(postId, userId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    delete rowsCache_.ReadMarks;   // 他の人の既読と重ならないよう、最新を読み直す
    const m = readMarks_()[postId];
    if (!m) {
      appendRow_('ReadMarks', { postId: postId, userIds: userId });
    } else if (m.ids.indexOf(userId) < 0) {
      m.ids.push(userId);
      updateRow_('ReadMarks', m._row, { postId: postId, userIds: m.ids.join(',') });
    }
  } finally {
    lock.releaseLock();
  }
}

// 以前の形式（1回の既読ごとに1行）の「Reads」シートを、新しい形式に1度だけ移す
let readsMigrated_ = false;
function migrateReads_() {
  if (readsMigrated_) return;
  readsMigrated_ = true;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('READS_MIGRATED')) return;
  const old = spreadsheet_().getSheetByName('Reads');
  if (old) {
    const values = old.getDataRange().getValues();
    values.shift();
    const map = {};
    const order = [];
    values.forEach(function (r) {
      const pid = String(r[0] || '');
      const uid = String(r[1] || '');
      if (!pid || !uid) return;
      if (!map[pid]) { map[pid] = []; order.push(pid); }
      if (map[pid].indexOf(uid) < 0) map[pid].push(uid);
    });
    const sh = sheet_('ReadMarks');
    if (order.length) {
      sh.getRange(sh.getLastRow() + 1, 1, order.length, 2).setValues(order.map(function (pid) {
        return [cell_(pid), cell_(map[pid].join(','))];
      }));
      delete rowsCache_.ReadMarks;
    }
    old.setName('Reads_旧（削除してOK）');
  }
  props.setProperty('READS_MIGRATED', '1');
}

function countBy_(rows, key) {
  const counts = {};
  rows.forEach(function (r) { counts[r[key]] = (counts[r[key]] || 0) + 1; });
  return counts;
}

function sendNoticeMail_(p, author) {
  const list = readRows_('Users').filter(function (r) { return r.active === '1' && r.email; })
    .map(function (r) { return r.email; });
  if (!list.length) return { sent: 0, message: 'メールアドレスを登録しているメンバーがいないため、メールは送っていません。' };
  const chunks = [];
  for (let i = 0; i < list.length; i += 40) chunks.push(list.slice(i, i + 40));
  const need = list.length + chunks.length;
  const quota = MailApp.getRemainingDailyQuota();
  if (quota < need) {
    return { sent: 0, message: '本日のメール送信上限（残り' + quota + '通）を超えるため、メールは送れませんでした。お知らせはアプリに掲載されています。' };
  }
  const owner = Session.getEffectiveUser().getEmail();
  const subject = '【' + appName_() + '】' + (p.important === '1' ? '【重要】' : '') + 'お知らせ：' + p.title;
  const body = p.title + '\n\n' + p.body + '\n\n――――――\n' + author.name + 'さんからのお知らせです。\n' +
    'アプリで確認する：' + ScriptApp.getService().getUrl() + '\n※このメールに返信しても届きません。';
  chunks.forEach(function (c) {
    MailApp.sendEmail({ to: owner, bcc: c.join(','), subject: subject, body: body, name: appName_() });
  });
  return { sent: list.length, message: list.length + '人にメールを送りました。' };
}

// ===== 未読のまとめメール =====
const DIGEST_HOURS = [7, 18];            // 送る時刻（日本時間）
const DIGEST_MAIL_RESERVE = 10;          // お知らせメール用に残しておく送信数

// setup から呼ばれる：毎日7時・18時に runDigest を動かす設定（すでにあれば作らない）
function installDigestTriggers_() {
  const exists = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'runDigest'; });
  if (exists.length >= DIGEST_HOURS.length) {
    Logger.log('まとめメールの自動送信は設定済みです（毎日' + DIGEST_HOURS.join('時・') + '時）。');
    return;
  }
  exists.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  DIGEST_HOURS.forEach(function (h) {
    ScriptApp.newTrigger('runDigest').timeBased().atHour(h).everyDays(1).inTimezone('Asia/Tokyo').create();
  });
  Logger.log('まとめメールの自動送信を設定しました（毎日' + DIGEST_HOURS.join('時・') + '時ごろ）。');
}

// 1人分のまとめ。since（前回送った時刻）以降に新しい未読があるかも調べる
function digestFor_(u, since, withTerritory) {
  const myGroups = myGroups_(u);
  const readSet = readSetFor_(u.id);
  const names = userNames_();
  let newCount = 0;
  // 掲示板・お知らせ・グループの掲示板
  const board = { board: 0, notice: 0, group: 0, notices: [] };
  livePosts_().forEach(function (p) {
    if (p.authorId === u.id || readSet[p.id]) return;
    let kind;
    if (p.groupId) {
      const g = myGroups[p.groupId];
      if (!g || !hasFeature_(g.group, 'board')) return;
      kind = 'group';
    } else {
      kind = p.type === 'notice' ? 'notice' : 'board';
    }
    board[kind]++;
    if (kind === 'notice' && board.notices.length < 3) board.notices.push(p.title);
    if (!since || p.createdAt > since) newCount++;
  });
  // メッセージ
  const convIds = myConvIds_(u, myGroups);
  const set = {};
  convIds.forEach(function (id) { set[id] = true; });
  const reads = chatReads_();
  const chat = {};
  liveMessages_().forEach(function (m) {
    if (!set[m.convId] || m.authorId === u.id) return;
    const r = reads[m.convId] && reads[m.convId][u.id];
    if (r && m.createdAt <= r.lastReadAt) return;
    chat[m.convId] = (chat[m.convId] || 0) + 1;
    if (!since || m.createdAt > since) newCount++;
  });
  const pairs = {};
  readRows_('DmPairs').forEach(function (p) { pairs[p.id] = p; });
  const chatList = Object.keys(chat).map(function (id) {
    let title;
    if (id.indexOf('g_') === 0) title = myGroups[id.slice(2)].group.name;
    else {
      const p = pairs[id];
      title = (names[p.userA === u.id ? p.userB : p.userA] || '（退会したメンバー）') + 'さん';
    }
    return { title: title, count: chat[id] };
  }).sort(function (a, b) { return b.count - a.count; });
  const chatTotal = chatList.reduce(function (n, c) { return n + c.count; }, 0);
  // 区域カード（朝の分だけ）
  const terr = withTerritory ? terrSummary_(u).alerts : [];
  return {
    board: board, chatList: chatList, chatTotal: chatTotal, terr: terr, newCount: newCount,
    urgent: terr.some(function (a) { return a.kind !== 'due'; })
  };
}

function digestBody_(u, d) {
  const lines = [u.name + 'さん', '', appName_() + 'の未読のお知らせです。', ''];
  if (d.terr.length) {
    lines.push('■ 区域カード');
    d.terr.forEach(function (a) {
      const label = '区域' + a.number + (a.name ? '（' + a.name + '）' : '');
      const msg = a.kind === 'return' ? '貸出対象外になりました。返却をお願いします'
        : a.kind === 'overdue' ? '返却期限（' + a.dueDate + '）を過ぎています'
        : '返却期限（' + a.dueDate + '）が近づいています';
      lines.push('・' + label + '：' + msg);
    });
    lines.push('');
  }
  if (d.chatTotal) {
    lines.push('■ メッセージ　未読 ' + d.chatTotal + '件');
    d.chatList.slice(0, 5).forEach(function (c) { lines.push('・' + c.title + '：' + c.count + '件'); });
    if (d.chatList.length > 5) lines.push('・ほか ' + (d.chatList.length - 5) + '件のトーク');
    lines.push('');
  }
  const b = d.board;
  if (b.notice || b.board || b.group) {
    lines.push('■ 掲示板');
    if (b.notice) {
      lines.push('・お知らせ：未読 ' + b.notice + '件');
      b.notices.forEach(function (t) { lines.push('　「' + t + '」'); });
    }
    if (b.board) lines.push('・全体の掲示板：未読 ' + b.board + '件');
    if (b.group) lines.push('・グループの掲示板：未読 ' + b.group + '件');
    lines.push('');
  }
  lines.push('アプリを開く：' + ScriptApp.getService().getUrl());
  lines.push('');
  lines.push('――――――');
  lines.push('このメールは、未読があるときに1日2回（' + DIGEST_HOURS.join('時・') + '時ごろ）お送りしています。');
  lines.push('受け取らない場合は、アプリの「メニュー → アカウント」で設定を変えられます。');
  lines.push('※このメールに返信しても届きません。');
  return lines.join('\n');
}

function digestSubject_(d) {
  const parts = [];
  if (d.urgent) parts.push('区域カードの返却');
  if (d.chatTotal) parts.push('メッセージ' + d.chatTotal + '件');
  const b = d.board.board + d.board.notice + d.board.group;
  if (b) parts.push('掲示板' + b + '件');
  if (!parts.length && d.terr.length) parts.push('区域カードの返却期限');
  return '【' + appName_() + '】未読のお知らせ（' + parts.join('・') + '）';
}

// 自動実行される関数（エディタから手動で実行してもよい）
function runDigest() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const hour = Number(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'H'));
    const morning = hour < 12;
    if (morning) {
      try { runCleanup(); } catch (e) { Logger.log('ファイルの片付けでエラー：' + e.message); }
    }
    const now = nowIso_();
    const candidates = [];
    readRows_('Users').forEach(function (u) {
      if (u.active !== '1' || !u.email || u.digestOff === '1') return;
      const d = digestFor_(u, u.lastDigestAt, morning);
      // 前回のメール以降に新しい未読がない人には送らない（区域カードの知らせは朝に毎日送る）
      if (!d.newCount && !d.terr.length) return;
      candidates.push({ u: u, d: d });
    });
    // 送信数の上限を超えそうなときは、区域カードの返却が必要な人 → 未読の多い人の順に送る
    candidates.sort(function (a, b) {
      if (a.d.urgent !== b.d.urgent) return a.d.urgent ? -1 : 1;
      return (b.d.chatTotal + b.d.newCount) - (a.d.chatTotal + a.d.newCount);
    });
    let quota = MailApp.getRemainingDailyQuota() - DIGEST_MAIL_RESERVE;
    let sent = 0, skipped = 0;
    candidates.forEach(function (c) {
      if (quota <= 0) { skipped++; return; }
      try {
        MailApp.sendEmail({ to: c.u.email, subject: digestSubject_(c.d), body: digestBody_(c.u, c.d), name: appName_() });
        c.u.lastDigestAt = now;
        updateRow_('Users', c.u._row, c.u);
        quota--;
        sent++;
      } catch (e) {
        Logger.log('送信できませんでした：' + c.u.email + '（' + e.message + '）');
      }
    });
    Logger.log('まとめメール：' + sent + '人に送信' + (skipped ? '、送信上限のため' + skipped + '人は次回に回しました' : '') + '。');
    return { sent: sent, skipped: skipped };
  } finally {
    lock.releaseLock();
  }
}

function api_setDigest(token, on) {
  const u = requireUser_(token);
  u.digestOff = on ? '0' : '1';
  updateRow_('Users', u._row, u);
  return publicUser_(u);
}

// 自分あてに、今の内容でまとめメールを送ってみる
function api_sendDigestTest(token) {
  const u = requireUser_(token);
  if (!u.email) throw new Error('メールアドレスが登録されていません。上の「プロフィール」で登録してください。');
  if (MailApp.getRemainingDailyQuota() <= DIGEST_MAIL_RESERVE) throw new Error('本日のメール送信数が上限に近いため、送れませんでした。明日お試しください。');
  const d = digestFor_(u, '', true);
  const empty = !d.chatTotal && !d.terr.length && !(d.board.board + d.board.notice + d.board.group);
  const body = empty
    ? u.name + 'さん\n\n' + appName_() + 'のまとめメールのテストです。今は未読がありません。\n未読があるときは、このアドレスに1日2回（' + DIGEST_HOURS.join('時・') + '時ごろ）お知らせします。\n\nアプリを開く：' + ScriptApp.getService().getUrl()
    : digestBody_(u, d);
  MailApp.sendEmail({ to: u.email, subject: '【' + appName_() + '】まとめメールのテスト', body: body, name: appName_() });
  return u.email;
}

// ===== 区域カード =====
function isTerrAdmin_(u) {
  return u.territoryAdmin === '1';
}

function requireTerrAdmin_(u) {
  if (!isTerrAdmin_(u)) throw new Error('この操作は区域カード管理者のみ行えます。');
}

function todayJst_() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

function dueDays_() {
  const n = Number(PropertiesService.getScriptProperties().getProperty('TERR_DUE_DAYS'));
  return n >= 1 ? n : DEFAULT_DUE_DAYS;
}

function liveTerritories_() {
  return readRows_('Territories').filter(function (t) { return t.deleted !== '1'; })
    .sort(function (a, b) { return compareTerr_(a.number, b.number); });
}

function recentlyReturnedBy_(t, u) {
  if (t.lastUserId !== u.id || !t.lastReturnedAt) return false;
  return Date.now() - new Date(t.lastReturnedAt).getTime() < COMMENT_AFTER_RETURN_HOURS * 3600000;
}

// 一般メンバーに見えるのは「貸出対象」「自分が借りている」「自分が最近返した」カード。リストは全員が見られる
function canSeeTerritory_(u, t) {
  return t.type === 'list' || isTerrAdmin_(u) || t.available === '1' || t.holderId === u.id || recentlyReturnedBy_(t, u);
}

// 地図型（貸し出しする区域カード）か
function isLendable_(t) {
  return t.type !== 'list';
}

function findTerritoryFor_(u, id) {
  const t = liveTerritories_().find(function (r) { return r.id === id; });
  if (!t || !canSeeTerritory_(u, t)) throw new Error('区域カードが見つかりません。');
  return t;
}

function terrView_(u, t, names, warnCounts, commentCounts) {
  if (!isLendable_(t)) {
    // リストは貸し出しをしない（借りる・返却・期限の情報は持たない）
    return {
      id: t.id, number: String(t.number), name: t.name, type: t.type, available: false,
      held: false, heldByMe: false, holderName: '', borrowedAt: '', dueDate: '', overdue: false, needReturn: false,
      lastUserName: '', lastUsedDate: '',
      warnCount: warnCounts[t.id] || 0, commentCount: commentCounts[t.id] || 0
    };
  }
  const today = todayJst_();
  const held = !!(t.holderId || t.holderName);
  const holderName = t.holderId ? (names[t.holderId] || '（退会したメンバー）') : t.holderName;
  const lastName = t.lastUserId ? (names[t.lastUserId] || t.lastUserName || '') : t.lastUserName;
  return {
    id: t.id, number: String(t.number), name: t.name, type: t.type,
    available: t.available === '1',
    held: held, heldByMe: t.holderId === u.id,
    holderName: holderName || '', borrowedAt: t.borrowedAt, dueDate: t.dueDate,
    overdue: held && !!t.dueDate && t.dueDate < today,
    needReturn: held && t.available !== '1',
    lastUserName: lastName || '', lastUsedDate: t.lastUsedDate,
    warnCount: warnCounts[t.id] || 0, commentCount: commentCounts[t.id] || 0
  };
}

function terrCounts_() {
  const warn = {};
  const all = {};
  readRows_('TerritoryComments').forEach(function (c) {
    if (c.deleted === '1') return;
    all[c.territoryId] = (all[c.territoryId] || 0) + 1;
    if (c.warn === '1') warn[c.territoryId] = (warn[c.territoryId] || 0) + 1;
  });
  return { warn: warn, all: all };
}

// ホーム用：自分が借りているカードと注意事項
function terrSummary_(u) {
  if (!featureOn_('cards')) return { holding: 0, alerts: [] };
  const today = todayJst_();
  const mine = liveTerritories_().filter(function (t) { return isLendable_(t) && t.holderId === u.id; });
  return {
    holding: mine.length,
    alerts: mine.filter(function (t) { return t.available !== '1' || (t.dueDate && t.dueDate <= shiftDate_(today, 2)); })
      .map(function (t) {
        let kind = 'due';
        if (t.available !== '1') kind = 'return';
        else if (t.dueDate < today) kind = 'overdue';
        return { id: t.id, number: String(t.number), name: t.name, dueDate: t.dueDate, kind: kind };
      })
  };
}

function api_territories(token) {
  const u = requireUser_(token);
  requireFeature_('cards');
  const names = userNames_();
  const counts = terrCounts_();
  const cards = liveTerritories_().filter(function (t) { return canSeeTerritory_(u, t); })
    .map(function (t) { return terrView_(u, t, names, counts.warn, counts.all); });
  return { isAdmin: isTerrAdmin_(u), dueDays: dueDays_(), cards: cards };
}

function api_territory(token, id) {
  const u = requireUser_(token);
  requireFeature_('cards');
  const t = findTerritoryFor_(u, id);
  const names = userNames_();
  const counts = terrCounts_();
  const v = terrView_(u, t, names, counts.warn, counts.all);
  const admin = isTerrAdmin_(u);
  v.fileId = t.type === 'map' ? t.fileId : '';
  v.isAdmin = admin;
  const lendable = isLendable_(t);
  v.canInk = lendable && (admin || t.holderId === u.id);
  v.canComment = !lendable || admin || t.holderId === u.id || recentlyReturnedBy_(t, u);
  v.canBorrow = lendable && t.available === '1' && !v.held;
  v.canReturn = lendable && v.held && (t.holderId === u.id || admin);
  // リストのURLは全員に渡す（開けるのはスプレッドシートを共有されている人だけ）
  v.sheetUrl = t.type === 'list' ? t.sheetUrl : '';
  const ink = readRows_('TerritoryInk').find(function (r) { return r.territoryId === t.id; });
  v.ink = ink ? ink.data : '';
  v.comments = terrComments_(u, t.id, names);
  if (t.type === 'list') {
    try {
      v.list = readListSheet_(t);
    } catch (e) {
      v.list = null;
      v.listError = 'スプレッドシートを読み込めませんでした。区域カード管理者に、URLと共有設定の確認を依頼してください。';
    }
  }
  return v;
}

function api_borrowTerritory(token, id) {
  const u = requireUser_(token);
  requireFeature_('cards');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const t = findTerritoryFor_(u, id);
    if (!isLendable_(t)) throw new Error('リストは借りずに、そのまま使えます。');
    if (t.available !== '1') throw new Error('この区域は現在、貸出対象ではありません。');
    if (t.holderId || t.holderName) throw new Error('この区域は、すでに他の人が借りています。');
    lend_(t, u.id, '', u.id);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function lend_(t, userId, name, operatorId) {
  const now = nowIso_();
  t.holderId = userId || '';
  t.holderName = userId ? '' : name;
  t.borrowedAt = now;
  t.dueDate = shiftDate_(todayJst_(), dueDays_());
  t.updatedAt = now;
  updateRow_('Territories', t._row, t);
  appendRow_('TerritoryLog', {
    id: 'l' + randomToken_().slice(0, 15), territoryId: t.id, userId: t.holderId, userName: t.holderName,
    borrowedAt: now, dueDate: t.dueDate, returnedAt: '', usedDate: '', operatorId: operatorId
  });
}

function api_returnTerritory(token, id, usedDate) {
  const u = requireUser_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const t = findTerritoryFor_(u, id);
    if (!t.holderId && !t.holderName) throw new Error('この区域は貸し出されていません。');
    if (t.holderId !== u.id && !isTerrAdmin_(u)) throw new Error('借りている人か区域カード管理者だけが返却できます。');
    usedDate = String(usedDate || '');
    if (usedDate && !isDate_(usedDate)) throw new Error('使った日を正しく入力してください。');
    if (usedDate && usedDate > todayJst_()) throw new Error('使った日に、未来の日付は入れられません。');
    const now = nowIso_();
    const log = readRows_('TerritoryLog').filter(function (r) { return r.territoryId === t.id && !r.returnedAt; })
      .sort(function (a, b) { return a.borrowedAt < b.borrowedAt ? 1 : -1; })[0];
    if (log) {
      log.returnedAt = now;
      log.usedDate = usedDate;
      updateRow_('TerritoryLog', log._row, log);
    }
    t.lastUserId = t.holderId;
    t.lastUserName = t.holderId ? '' : t.holderName;
    if (usedDate) t.lastUsedDate = usedDate;
    t.lastReturnedAt = now;
    t.holderId = '';
    t.holderName = '';
    t.borrowedAt = '';
    t.dueDate = '';
    t.updatedAt = now;
    updateRow_('Territories', t._row, t);
    return true;
  } finally {
    lock.releaseLock();
  }
}

// 区域カード管理者：アプリを使わない人の分も含めて代理で貸し出す
function api_lendTerritory(token, id, userId, name) {
  const u = requireUser_(token);
  requireTerrAdmin_(u);
  userId = String(userId || '');
  name = String(name || '').trim();
  if (userId && !activeUsers_()[userId]) throw new Error('メンバーが見つかりません。');
  if (!userId && (!name || name.length > 30)) throw new Error('貸し出す相手を選ぶか、名前を入力してください。');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const t = findTerritoryFor_(u, id);
    if (!isLendable_(t)) throw new Error('リストは貸し出しをしません。');
    if (t.holderId || t.holderName) throw new Error('この区域は、すでに貸し出し中です。先に返却してください。');
    lend_(t, userId, userId ? '' : name, u.id);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function api_territoryHistory(token, id) {
  const u = requireUser_(token);
  requireTerrAdmin_(u);
  const names = userNames_();
  return readRows_('TerritoryLog').filter(function (r) { return r.territoryId === id; })
    .sort(function (a, b) { return a.borrowedAt < b.borrowedAt ? 1 : -1; })
    .slice(0, 50).map(function (r) {
      return {
        name: r.userId ? (names[r.userId] || '（退会したメンバー）') : r.userName,
        borrowedAt: r.borrowedAt, returnedAt: r.returnedAt, usedDate: r.usedDate, dueDate: r.dueDate,
        byAdmin: r.operatorId && r.operatorId !== r.userId
      };
    });
}

// 区域カード管理者：貸出対象をまとめて設定（ids に含まれるものだけ対象にする）
function api_setAvailable(token, ids) {
  const u = requireUser_(token);
  requireTerrAdmin_(u);
  const set = {};
  (Array.isArray(ids) ? ids : []).forEach(function (id) { set[id] = true; });
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_('Territories');
    const col = SHEETS.Territories.indexOf('available') + 1;
    let changed = 0;
    liveTerritories_().forEach(function (t) {
      const v = set[t.id] && isLendable_(t) ? '1' : '0';
      if (t.available !== v) {
        sh.getRange(t._row, col).setValue(cell_(v));
        changed++;
      }
    });
    delete rowsCache_.Territories;
    return changed;
  } finally {
    lock.releaseLock();
  }
}

function api_setDueDays(token, days) {
  const u = requireUser_(token);
  requireTerrAdmin_(u);
  days = Math.floor(Number(days));
  if (!(days >= 1 && days <= 365)) throw new Error('返却期限は1〜365日で入力してください。');
  PropertiesService.getScriptProperties().setProperty('TERR_DUE_DAYS', String(days));
  return days;
}

// 区域番号：「12」または枝番つきの「1-1」。全角数字や「_」「ー」などの区切りもそろえる
function cleanTerrNumber_(n) {
  let v = String(n === undefined || n === null ? '' : n).trim()
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/\s*[_‐－ー−―\-]\s*/g, '-');
  const m = v.match(/^(\d{1,4})(?:-(\d{1,3}))?$/);
  if (!m) throw new Error('区域番号は「12」または「1-1」のように入力してください。');
  const main = Number(m[1]);
  if (main < 1) throw new Error('区域番号は1以上にしてください。');
  return m[2] ? main + '-' + Number(m[2]) : String(main);
}

// 並べ替え用：「1-2」→ [1, 2]、「12」→ [12, 0]
function terrKey_(label) {
  const p = String(label).split('-');
  return [Number(p[0]) || 0, Number(p[1]) || 0];
}
function compareTerr_(a, b) {
  const x = terrKey_(a), y = terrKey_(b);
  return x[0] - y[0] || x[1] - y[1];
}

function cleanTerrName_(s) {
  s = String(s || '').trim();
  if (s.length > 40) throw new Error('区域の名前は40文字以内にしてください。');
  return s;
}

// 地図型カードの登録（同じ番号があれば replace=true のとき地図を差し替え）
function api_saveMapCard(token, number, name, mime, base64, replace) {
  const u = requireUser_(token);
  requireTerrAdmin_(u);
  number = cleanTerrNumber_(number);
  name = cleanTerrName_(name);
  if (['image/jpeg', 'image/png'].indexOf(mime) < 0) throw new Error('地図は画像（JPG・PNG）で登録してください。');
  const bytes = Utilities.base64Decode(String(base64 || ''));
  if (!bytes.length) throw new Error('ファイルが空です。');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('地図の画像が大きすぎます（5MBまで）。');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const exist = liveTerritories_().find(function (t) { return isLendable_(t) && String(t.number) === number; });
    if (exist && !replace) throw new Error('区域' + number + 'はすでに登録されています。');
    const file = folder_().createFile(Utilities.newBlob(bytes, mime, '区域' + number + (mime === 'image/png' ? '.png' : '.jpg')));
    const now = nowIso_();
    const id = exist ? exist.id : 't' + randomToken_().slice(0, 15);
    const rec = {
      id: 'f_' + randomToken_().slice(0, 16), driveId: file.getId(), ownerType: 'territory', ownerId: id,
      name: '区域' + number, mime: mime, size: String(bytes.length), uploadedBy: u.id, createdAt: now, deleted: ''
    };
    appendRow_('Files', rec);
    if (exist) {
      const old = readRows_('Files').find(function (f) { return f.id === exist.fileId; });
      if (old) trashFile_(old);
      exist.fileId = rec.id;
      if (name) exist.name = name;
      exist.updatedAt = now;
      updateRow_('Territories', exist._row, exist);
      return { id: id, replaced: true };
    }
    appendRow_('Territories', newTerritory_(id, number, name, 'map', now, { fileId: rec.id }));
    return { id: id, replaced: false };
  } finally {
    lock.releaseLock();
  }
}

function newTerritory_(id, number, name, type, now, extra) {
  const t = {
    id: id, number: String(number), name: name, type: type, fileId: '', sheetId: '', sheetGid: '', sheetUrl: '',
    available: '0', holderId: '', holderName: '', borrowedAt: '', dueDate: '',
    lastUserId: '', lastUserName: '', lastUsedDate: '', lastReturnedAt: '',
    createdAt: now, updatedAt: now, deleted: ''
  };
  Object.keys(extra || {}).forEach(function (k) { t[k] = extra[k]; });
  return t;
}

function parseSheetUrl_(url) {
  url = String(url || '').trim();
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (!m) throw new Error('GoogleスプレッドシートのURLを貼り付けてください。');
  const g = url.match(/[#&?]gid=(\d+)/);
  return { id: m[1], gid: g ? g[1] : '', url: url };
}

function api_saveListCard(token, id, number, name, url) {
  const u = requireUser_(token);
  requireTerrAdmin_(u);
  number = cleanTerrNumber_(number);
  name = cleanTerrName_(name);
  const sheet = parseSheetUrl_(url);
  // 読み込めるか先に確認
  try {
    listSheet_({ sheetId: sheet.id, sheetGid: sheet.gid });
  } catch (e) {
    throw new Error('このスプレッドシートを開けませんでした。URLと、あなたのGoogleアカウントで開ける表かどうかを確認してください。');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const all = liveTerritories_();
    const dup = all.find(function (t) { return t.type === 'list' && String(t.number) === number && t.id !== id; });
    if (dup) throw new Error('リスト' + number + 'はすでに登録されています。');
    const now = nowIso_();
    if (id) {
      const t = all.find(function (r) { return r.id === id; });
      if (!t || t.type !== 'list') throw new Error('区域カードが見つかりません。');
      t.number = String(number);
      t.name = name;
      t.sheetId = sheet.id;
      t.sheetGid = sheet.gid;
      t.sheetUrl = sheet.url;
      t.updatedAt = now;
      updateRow_('Territories', t._row, t);
      return t.id;
    }
    const nid = 't' + randomToken_().slice(0, 15);
    appendRow_('Territories', newTerritory_(nid, number, name, 'list', now, { sheetId: sheet.id, sheetGid: sheet.gid, sheetUrl: sheet.url }));
    return nid;
  } finally {
    lock.releaseLock();
  }
}

function api_updateTerritory(token, id, number, name) {
  const u = requireUser_(token);
  requireTerrAdmin_(u);
  number = cleanTerrNumber_(number);
  name = cleanTerrName_(name);
  const all = liveTerritories_();
  const t = all.find(function (r) { return r.id === id; });
  if (!t) throw new Error('区域カードが見つかりません。');
  if (all.some(function (r) { return isLendable_(r) === isLendable_(t) && String(r.number) === number && r.id !== id; })) {
    throw new Error((isLendable_(t) ? '区域' : 'リスト') + number + 'はすでに登録されています。');
  }
  t.number = String(number);
  t.name = name;
  t.updatedAt = nowIso_();
  updateRow_('Territories', t._row, t);
  return true;
}

function api_deleteTerritory(token, id) {
  const u = requireUser_(token);
  requireTerrAdmin_(u);
  const t = liveTerritories_().find(function (r) { return r.id === id; });
  if (!t) throw new Error('区域カードが見つかりません。');
  if (isLendable_(t) && (t.holderId || t.holderName)) throw new Error('貸し出し中のカードは削除できません。先に返却してください。');
  t.deleted = '1';
  t.updatedAt = nowIso_();
  updateRow_('Territories', t._row, t);
  if (t.fileId) {
    const f = readRows_('Files').find(function (r) { return r.id === t.fileId; });
    if (f) trashFile_(f);
  }
  return true;
}

// ===== 区域カード：書き込み・コメント =====
// 書き込みの保存。各書き込みには書いた人のID（a）を付け、
// 区域カード管理者でない人は、自分以外が書いたものを消せない
function api_saveInk(token, id, data) {
  const u = requireUser_(token);
  const t = findTerritoryFor_(u, id);
  const admin = isTerrAdmin_(u);
  if (t.holderId !== u.id && !admin) throw new Error('地図に書き込めるのは、借りている人と区域カード管理者だけです。');
  data = String(data || '');
  let items = [];
  if (data) {
    let parsed;
    try { parsed = JSON.parse(data); } catch (e) { throw new Error('書き込みのデータが正しくありません。'); }
    if (!parsed || !Array.isArray(parsed.items)) throw new Error('書き込みのデータが正しくありません。');
    items = parsed.items;
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const row = readRows_('TerritoryInk').find(function (r) { return r.territoryId === t.id; });
    let oldItems = [];
    try { oldItems = row && row.data ? (JSON.parse(row.data).items || []) : []; } catch (e) { oldItems = []; }
    const oldKeys = {};
    oldItems.forEach(function (it) { oldKeys[JSON.stringify(it)] = true; });
    const newKeys = {};
    items.forEach(function (it) { newKeys[JSON.stringify(it)] = true; });
    if (!admin) {
      const removedOthers = oldItems.some(function (it) { return it.a !== u.id && !newKeys[JSON.stringify(it)]; });
      if (removedOthers) throw new Error('ほかの人が書いたものは消せません。区域カード管理者に依頼してください。');
    }
    // 新しく加わった書き込みは、保存した人が書いたものとして記録
    items = items.map(function (it) {
      if (oldKeys[JSON.stringify(it)]) return it;
      const copy = {};
      Object.keys(it).forEach(function (k) { copy[k] = it[k]; });
      copy.a = u.id;
      return copy;
    });
    const out = items.length ? JSON.stringify({ v: 1, items: items }) : '';
    if (out.length > MAX_INK_CHARS) throw new Error('書き込みが多すぎて保存できません。区域カード管理者に、古い書き込みの消去を依頼してください。');
    const rec = { territoryId: t.id, data: out, updatedAt: nowIso_(), updatedBy: u.id };
    if (row) updateRow_('TerritoryInk', row._row, rec);
    else appendRow_('TerritoryInk', rec);
    return out;
  } finally {
    lock.releaseLock();
  }
}

function terrComments_(u, territoryId, names) {
  const admin = isTerrAdmin_(u);
  return readRows_('TerritoryComments').filter(function (c) { return c.territoryId === territoryId && c.deleted !== '1'; })
    .sort(function (a, b) {
      if (a.warn !== b.warn) return a.warn === '1' ? -1 : 1;   // 要注意を先に
      return a.createdAt < b.createdAt ? 1 : -1;               // 新しい順
    })
    .map(function (c) {
      return {
        id: c.id, body: c.body, warn: c.warn === '1', createdAt: c.createdAt,
        authorName: names[c.authorId] || '（退会したメンバー）',
        canDelete: admin || c.authorId === u.id
      };
    });
}

function api_addTerritoryComment(token, id, body, warn) {
  const u = requireUser_(token);
  const t = findTerritoryFor_(u, id);
  if (isLendable_(t) && !isTerrAdmin_(u) && t.holderId !== u.id && !recentlyReturnedBy_(t, u)) {
    throw new Error('コメントを書けるのは、借りている人（返却後3日以内を含む）と区域カード管理者だけです。');
  }
  body = String(body || '').trim();
  if (!body) throw new Error('コメントを入力してください。');
  if (body.length > 500) throw new Error('コメントは500文字以内にしてください。');
  appendRow_('TerritoryComments', {
    id: 'tc' + randomToken_().slice(0, 14), territoryId: t.id, authorId: u.id, body: body,
    warn: warn ? '1' : '0', createdAt: nowIso_(), deleted: ''
  });
  return terrComments_(u, t.id, userNames_());
}

function api_deleteTerritoryComment(token, commentId) {
  const u = requireUser_(token);
  const c = readRows_('TerritoryComments').find(function (r) { return r.id === commentId && r.deleted !== '1'; });
  if (!c) throw new Error('コメントが見つかりません。');
  findTerritoryFor_(u, c.territoryId);
  if (c.authorId !== u.id && !isTerrAdmin_(u)) throw new Error('このコメントは削除できません。');
  c.deleted = '1';
  updateRow_('TerritoryComments', c._row, c);
  return terrComments_(u, c.territoryId, userNames_());
}

// ===== 区域カード：リスト型（Googleスプレッドシート） =====
// gid：読むシート（タブ）。指定がなければ登録したシート、それもなければ先頭のシート
function listSheet_(t, gid) {
  const book = SpreadsheetApp.openById(t.sheetId);
  const sheets = book.getSheets();
  const want = String(gid || t.sheetGid || '');
  if (want) {
    const found = sheets.find(function (s) { return String(s.getSheetId()) === want; });
    if (found) return { book: book, sheet: found, sheets: sheets };
  }
  return { book: book, sheet: sheets[0], sheets: sheets };
}

function safeUrl_(u) {
  u = String(u || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
}

// セルのリンク：HYPERLINK関数、またはセルに貼ったリンク
function cellLink_(formula, rich) {
  const m = String(formula || '').match(/^=\s*HYPERLINK\(\s*"([^"]+)"/i);
  if (m) return safeUrl_(m[1]);
  if (!rich) return '';
  let url = rich.getLinkUrl ? rich.getLinkUrl() : null;
  if (!url && rich.getRuns) {
    const runs = rich.getRuns();
    for (let i = 0; i < runs.length && !url; i++) url = runs[i].getLinkUrl();
  }
  return safeUrl_(url);
}

// 1行目を見出しとして、表をそのまま返す（表示用の文字と、リンク・数式の有無）
function readListSheet_(t, gid) {
  const ls = listSheet_(t, gid);
  const sh = ls.sheet;
  const out = {
    gid: String(sh.getSheetId()),
    sheets: ls.sheets.filter(function (s) { return !(s.isSheetHidden && s.isSheetHidden()); })
      .map(function (s) { return { gid: String(s.getSheetId()), name: s.getName() }; }),
    header: [], rows: [], links: {}, locked: {}, truncated: false
  };
  const lastRow = Math.min(sh.getLastRow(), LIST_MAX_ROWS + 1);
  const lastCol = Math.min(sh.getLastColumn(), LIST_MAX_COLS);
  if (lastRow < 1 || lastCol < 1) return out;
  const range = sh.getRange(1, 1, lastRow, lastCol);
  const values = range.getDisplayValues();
  let formulas = [], rich = [];
  try { formulas = range.getFormulas(); } catch (e) { formulas = []; }
  try { rich = range.getRichTextValues(); } catch (e) { rich = []; }
  // links / locked のキーは「見出しを除いた行番号,列番号」
  for (let r = 1; r < values.length; r++) {
    for (let c = 0; c < lastCol; c++) {
      const f = formulas[r] ? formulas[r][c] : '';
      const link = cellLink_(f, rich[r] ? rich[r][c] : null);
      if (link) out.links[(r - 1) + ',' + c] = link;
      if (f || link) out.locked[(r - 1) + ',' + c] = true;   // 数式やリンクは、アプリから上書きしない
    }
  }
  out.header = values.shift();
  out.rows = values;
  out.truncated = sh.getLastRow() > LIST_MAX_ROWS + 1 || sh.getLastColumn() > LIST_MAX_COLS;
  return out;
}

// 数式として実行されないよう、= + - @ で始まる入力は文字列として保存
function safeCell_(v) {
  v = String(v === undefined || v === null ? '' : v);
  if (v.length > 1000) throw new Error('1つのセルに入れられるのは1000文字までです。');
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function requireListCard_(u, id) {
  const t = findTerritoryFor_(u, id);
  if (t.type !== 'list') throw new Error('この区域はリスト型ではありません。');
  return t;
}

// 別のシート（タブ）を読む
function api_listSheet(token, id, gid) {
  const u = requireUser_(token);
  const t = requireListCard_(u, id);
  try {
    return readListSheet_(t, gid);
  } catch (e) {
    throw new Error('スプレッドシートを読み込めませんでした。区域カード管理者に、URLと共有設定の確認を依頼してください。');
  }
}

// rowIndex：見出しを除いた0始まりの行番号、expected：編集前の値（他の人と重なったら知らせる）
function api_listSetCell(token, id, rowIndex, colIndex, value, expected, gid) {
  const u = requireUser_(token);
  const t = requireListCard_(u, id);
  rowIndex = Math.floor(Number(rowIndex));
  colIndex = Math.floor(Number(colIndex));
  if (!(rowIndex >= 0 && rowIndex < LIST_MAX_ROWS) || !(colIndex >= 0 && colIndex < LIST_MAX_COLS)) throw new Error('編集する場所が正しくありません。');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = listSheet_(t, gid).sheet;
    const range = sh.getRange(rowIndex + 2, colIndex + 1);
    const current = range.getDisplayValue();
    if (expected !== undefined && expected !== null && String(expected) !== current) {
      throw new Error('ほかの人がこのセルを先に変更しました。最新の内容を表示しますので、もう一度入力してください。');
    }
    let rich = null, formula = '';
    try { formula = range.getFormula(); } catch (e) { formula = ''; }
    try { rich = range.getRichTextValue(); } catch (e) { rich = null; }
    if (formula || cellLink_('', rich)) throw new Error('リンクや数式が入ったセルは、アプリからは変更できません。スプレッドシートで編集してください。');
    range.setValue(safeCell_(value));
    return readListSheet_(t, gid);
  } finally {
    lock.releaseLock();
  }
}

function api_listAddRow(token, id, values, gid) {
  const u = requireUser_(token);
  const t = requireListCard_(u, id);
  values = (Array.isArray(values) ? values : []).slice(0, LIST_MAX_COLS).map(safeCell_);
  if (!values.some(function (v) { return String(v).trim(); })) throw new Error('1つ以上の欄を入力してください。');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = listSheet_(t, gid).sheet;
    if (sh.getLastRow() > LIST_MAX_ROWS) throw new Error('この表は' + LIST_MAX_ROWS + '行を超えているため、アプリからは追加できません。');
    sh.appendRow(values);
    return readListSheet_(t, gid);
  } finally {
    lock.releaseLock();
  }
}

// ===== カレンダー =====
const REPEATS = ['none', 'daily', 'weekly', 'monthly_date', 'monthly_nth'];
const WEEKDAY_JA = '日月火水木金土';

function canEditCalendar_(u) {
  return u.role === 'admin' || u.calendarEditor === '1';
}

function api_listEvents(token, from, to, groupId) {
  const u = requireUser_(token);
  requireFeature_('calendar');
  if (!isDate_(from) || !isDate_(to)) throw new Error('日付の指定が正しくありません。');
  const span = dayNum_(to) - dayNum_(from);
  if (span < 0 || span > 62) throw new Error('期間の指定が正しくありません。');
  groupId = String(groupId || '');
  const myGroups = myGroups_(u);
  if (groupId) requireGroupMember_(u, groupId, 'calendar');
  return {
    canEdit: canEditCalendar_(u),
    targets: eventTargets_(u, myGroups),
    events: visibleEvents_(u, myGroups, from, to, groupId)
  };
}

// 予定を追加できる先（全体／グループ）
function eventTargets_(u, myGroups) {
  const list = canEditCalendar_(u) ? [{ id: '', name: '全体' }] : [];
  Object.keys(myGroups).forEach(function (gid) {
    if (hasFeature_(myGroups[gid].group, 'calendar')) list.push({ id: gid, name: myGroups[gid].group.name });
  });
  return list;
}

// 見られる予定（全体＋自分のグループ）。groupId を指定するとそのグループだけ
function visibleEvents_(u, myGroups, from, to, groupId) {
  if (!featureOn_('calendar')) return [];
  return expandEvents_(from, to, function (ev) {
    if (groupId) return ev.groupId === groupId;
    if (!ev.groupId) return true;
    const g = myGroups[ev.groupId];
    return !!(g && hasFeature_(g.group, 'calendar'));
  }).map(function (e) {
    e.groupName = e.groupId && myGroups[e.groupId] ? myGroups[e.groupId].group.name : '';
    e.canEdit = canEditEvent_(u, e.groupId, myGroups);
    return e;
  });
}

function canEditEvent_(u, groupId, myGroups) {
  if (!groupId) return canEditCalendar_(u);
  const g = myGroups[groupId];
  return !!(g && hasFeature_(g.group, 'calendar'));
}

/**
 * mode：new（新規）／all（すべての回）／single（この日だけ）／future（この日以降すべて）
 * occurrenceDate：変更する回の日付（single・future のとき）
 */
function api_saveEvent(token, data, mode, occurrenceDate) {
  const u = requireUser_(token);
  requireFeature_('calendar');
  data = data || {};
  const myGroups = myGroups_(u);
  const denied = '全体の予定を追加・変更できるのは、全体管理者とカレンダー編集者だけです。';
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (mode === 'new' || !data.id) {
      const gid = String(data.groupId || '');
      if (gid) requireGroupMember_(u, gid, 'calendar');
      else if (!canEditCalendar_(u)) throw new Error(denied);
      const v = cleanEvent_(data);
      appendRow_('Events', newEventRow_(v, u, '', gid));
      return true;
    }
    const ev = liveEvents_().find(function (r) { return r.id === data.id; });
    if (!ev || (ev.groupId && !myGroups[ev.groupId])) throw new Error('予定が見つかりません。削除された可能性があります。');
    if (!canEditEvent_(u, ev.groupId, myGroups)) throw new Error(ev.groupId ? 'この予定は変更できません。' : denied);

    if (mode === 'single' && ev.repeat !== 'none') {
      if (!isDate_(occurrenceDate)) throw new Error('日付の指定が正しくありません。');
      data.repeat = 'none';
      const v = cleanEvent_(data);
      addExdate_(ev, occurrenceDate);
      touch_(ev);
      updateRow_('Events', ev._row, ev);
      appendRow_('Events', newEventRow_(v, u, '', ev.groupId));
      return true;
    }

    const v = cleanEvent_(data);
    if (mode === 'future' && ev.repeat !== 'none') {
      if (!isDate_(occurrenceDate)) throw new Error('日付の指定が正しくありません。');
      if (dayNum_(occurrenceDate) > dayNum_(ev.startDate)) {
        // 元の予定は前日で終了し、この日から新しい予定として続ける
        const keep = splitExdates_(ev.exdates, occurrenceDate);
        ev.untilDate = shiftDate_(occurrenceDate, -1);
        ev.exdates = keep.before.join(',');
        touch_(ev);
        updateRow_('Events', ev._row, ev);
        appendRow_('Events', newEventRow_(v, u, keep.after.join(','), ev.groupId));
        return true;
      }
    }

    // すべての回を変更
    Object.keys(v).forEach(function (k) { ev[k] = v[k]; });
    touch_(ev);
    updateRow_('Events', ev._row, ev);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function api_deleteEvent(token, eventId, mode, date) {
  const u = requireUser_(token);
  const myGroups = myGroups_(u);
  const ev = liveEvents_().find(function (r) { return r.id === eventId; });
  if (!ev || (ev.groupId && !myGroups[ev.groupId])) throw new Error('予定が見つかりません。削除された可能性があります。');
  if (!canEditEvent_(u, ev.groupId, myGroups)) {
    throw new Error(ev.groupId ? 'この予定は削除できません。' : '全体の予定を削除できるのは、全体管理者とカレンダー編集者だけです。');
  }
  if (ev.repeat === 'none' || mode === 'all') {
    ev.deleted = '1';
  } else {
    if (!isDate_(date)) throw new Error('日付の指定が正しくありません。');
    if (mode === 'single') {
      addExdate_(ev, date);
    } else if (dayNum_(date) <= dayNum_(ev.startDate)) {
      ev.deleted = '1';
    } else {
      ev.untilDate = shiftDate_(date, -1);
    }
  }
  touch_(ev);
  updateRow_('Events', ev._row, ev);
  return true;
}

function cleanEvent_(d) {
  const title = String(d.title || '').trim();
  if (!title || title.length > 60) throw new Error('タイトルは1〜60文字で入力してください。');
  const date = String(d.date || '');
  if (!isDate_(date)) throw new Error('日付を正しく入力してください。');
  const allDay = !!d.allDay;
  let startTime = '';
  let endTime = '';
  if (!allDay) {
    startTime = String(d.startTime || '');
    endTime = String(d.endTime || '');
    if (!/^\d{2}:\d{2}$/.test(startTime)) throw new Error('開始時刻を入力してください（終日の場合は「終日」にチェック）。');
    if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) throw new Error('終了時刻が正しくありません。');
    if (endTime && endTime <= startTime) throw new Error('終了時刻は開始時刻より後にしてください。');
  }
  const location = String(d.location || '').trim();
  if (location.length > 60) throw new Error('場所は60文字以内にしてください。');
  const memo = String(d.memo || '').trim();
  if (memo.length > 1000) throw new Error('メモは1000文字以内にしてください。');

  const repeat = REPEATS.indexOf(d.repeat) >= 0 ? d.repeat : 'none';
  const s = dayNum_(date);
  let weekdays = '';
  if (repeat === 'weekly') {
    const list = (Array.isArray(d.weekdays) ? d.weekdays : [])
      .map(Number).filter(function (n) { return n >= 0 && n <= 6; });
    const uniq = list.filter(function (n, i) { return list.indexOf(n) === i; }).sort();
    weekdays = (uniq.length ? uniq : [wday_(s)]).join(',');
  }
  let monthNth = '';
  if (repeat === 'monthly_nth') {
    const n = Math.ceil(dom_(s) / 7);
    monthNth = String(n >= 5 ? -1 : n);
  }
  let untilDate = '';
  if (repeat !== 'none' && d.until) {
    untilDate = String(d.until);
    if (!isDate_(untilDate)) throw new Error('終了日が正しくありません。');
    if (dayNum_(untilDate) < s) throw new Error('終了日は開始日より後にしてください。');
  }
  return {
    title: title, startDate: date, allDay: allDay ? '1' : '0', startTime: startTime, endTime: endTime,
    location: location, memo: memo, repeat: repeat, weekdays: weekdays, monthNth: monthNth, untilDate: untilDate
  };
}

function newEventRow_(v, u, exdates, groupId) {
  const now = nowIso_();
  const row = {
    id: 'e_' + randomToken_().slice(0, 16), exdates: exdates || '',
    scope: groupId ? 'group' : 'all', groupId: groupId || '',
    createdBy: u.id, createdAt: now, updatedAt: now, deleted: ''
  };
  Object.keys(v).forEach(function (k) { row[k] = v[k]; });
  return row;
}

function liveEvents_() {
  return readRows_('Events').filter(function (r) { return r.deleted !== '1'; });
}

// 期間内の予定を、繰り返しを展開して1回ずつのリストにする
function expandEvents_(from, to, filter) {
  const a = dayNum_(from);
  const b = dayNum_(to);
  const out = [];
  liveEvents_().forEach(function (ev) {
    if (!isDate_(ev.startDate)) return;
    if (filter && !filter(ev)) return;
    const s = dayNum_(ev.startDate);
    const e = ev.untilDate ? dayNum_(ev.untilDate) : Infinity;
    const ex = ev.exdates ? ev.exdates.split(',') : [];
    const lo = Math.max(a, s);
    const hi = Math.min(b, e);
    for (let d = lo; d <= hi; d++) {
      if (!occursOn_(ev, s, d)) continue;
      const ds = dateStr_(d);
      if (ex.indexOf(ds) >= 0) continue;
      out.push({
        id: ev.id, date: ds, title: ev.title, allDay: ev.allDay === '1',
        startTime: ev.startTime, endTime: ev.endTime, location: ev.location, memo: ev.memo,
        repeat: ev.repeat, repeatLabel: repeatLabel_(ev),
        weekdays: ev.weekdays ? ev.weekdays.split(',').map(Number) : [],
        startDate: ev.startDate, untilDate: ev.untilDate, groupId: ev.groupId || ''
      });
    }
  });
  return out.sort(function (x, y) {
    if (x.date !== y.date) return x.date < y.date ? -1 : 1;
    if (x.allDay !== y.allDay) return x.allDay ? -1 : 1;
    return x.startTime < y.startTime ? -1 : x.startTime > y.startTime ? 1 : 0;
  });
}

function occursOn_(ev, s, d) {
  switch (ev.repeat) {
    case 'daily':
      return true;
    case 'weekly':
      return ev.weekdays.split(',').indexOf(String(wday_(d))) >= 0;
    case 'monthly_date':
      return dom_(d) === dom_(s);
    case 'monthly_nth': {
      if (wday_(d) !== wday_(s)) return false;
      const n = Number(ev.monthNth);
      if (n === -1) return dom_(d) + 7 > daysInMonth_(d);
      return Math.ceil(dom_(d) / 7) === n;
    }
    default:
      return d === s;
  }
}

function repeatLabel_(ev) {
  const s = dayNum_(ev.startDate);
  let label = '';
  switch (ev.repeat) {
    case 'daily': label = '毎日'; break;
    case 'weekly':
      label = '毎週 ' + ev.weekdays.split(',').map(function (n) { return WEEKDAY_JA[Number(n)]; }).join('・') + '曜';
      break;
    case 'monthly_date': label = '毎月' + dom_(s) + '日'; break;
    case 'monthly_nth': {
      const n = Number(ev.monthNth);
      label = '毎月 ' + (n === -1 ? '最終' : '第' + n) + WEEKDAY_JA[wday_(s)] + '曜';
      break;
    }
    default: return '';
  }
  if (ev.untilDate) {
    const u = new Date(dayNum_(ev.untilDate) * 86400000);
    label += '（' + u.getUTCFullYear() + '/' + (u.getUTCMonth() + 1) + '/' + u.getUTCDate() + 'まで）';
  }
  return label;
}

function addExdate_(ev, date) {
  const list = ev.exdates ? ev.exdates.split(',') : [];
  if (list.indexOf(date) < 0) list.push(date);
  ev.exdates = list.join(',');
}

function splitExdates_(exdates, date) {
  const list = exdates ? exdates.split(',') : [];
  const n = dayNum_(date);
  return {
    before: list.filter(function (x) { return dayNum_(x) < n; }),
    after: list.filter(function (x) { return dayNum_(x) >= n; })
  };
}

function touch_(row) {
  row.updatedAt = nowIso_();
}

// 日付は "yyyy-MM-dd" の文字列で扱い、計算は1970/1/1からの日数で行う
function isDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const p = s.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}
function dayNum_(s) {
  const p = String(s).split('-').map(Number);
  return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
}
function dateStr_(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
function shiftDate_(s, k) {
  return dateStr_(dayNum_(s) + k);
}
function wday_(n) {
  return new Date(n * 86400000).getUTCDay();
}
function dom_(n) {
  return new Date(n * 86400000).getUTCDate();
}
function daysInMonth_(n) {
  const d = new Date(n * 86400000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

// ===== 内部処理 =====
function requireUser_(token) {
  if (!token) throw new Error('AUTH');
  const cache = CacheService.getScriptCache();
  let userId = cache.get('s_' + token);
  if (!userId) {
    const s = readRows_('Sessions').find(function (r) { return r.token === token; });
    if (!s || new Date(s.expiresAt) < new Date()) throw new Error('AUTH');
    userId = s.userId;
    cache.put('s_' + token, userId, 300);
  }
  const u = readRows_('Users').find(function (r) { return r.id === userId; });
  if (!u || u.active !== '1') throw new Error('AUTH');
  return u;
}

function requireAdmin_(token) {
  const u = requireUser_(token);
  if (u.role !== 'admin') throw new Error('この操作は全体管理者のみ行えます。');
  return u;
}

function createSession_(userId) {
  const token = randomToken_() + randomToken_();
  const now = new Date();
  appendRow_('Sessions', {
    token: token,
    userId: userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString()
  });
  if (Math.random() < 0.1) cleanupSessions_();
  return token;
}

function cleanupSessions_() {
  const now = new Date();
  deleteRows_('Sessions', readRows_('Sessions')
    .filter(function (r) { return new Date(r.expiresAt) < now; })
    .map(function (r) { return r._row; }));
}

function removeSessionsFor_(userId) {
  const cache = CacheService.getScriptCache();
  const rows = readRows_('Sessions').filter(function (r) { return r.userId === userId; });
  rows.forEach(function (r) { cache.remove('s_' + r.token); });
  deleteRows_('Sessions', rows.map(function (r) { return r._row; }));
}

function createInvite_(role, createdBy, days, note) {
  const existing = readRows_('Invites').map(function (r) { return r.code; });
  let code;
  do { code = randomCode_(8); } while (existing.indexOf(code) >= 0);
  const now = new Date();
  const inv = {
    code: code,
    role: role,
    createdBy: createdBy,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86400000).toISOString(),
    usedBy: '',
    usedAt: '',
    note: note || ''
  };
  appendRow_('Invites', inv);
  return inv;
}

function hashPassword_(password, salt) {
  const pepper = PropertiesService.getScriptProperties().getProperty('PEPPER') || '';
  const key = Utilities.newBlob(pepper + salt).getBytes();
  let h = Utilities.computeHmacSha256Signature(Utilities.newBlob(salt + password).getBytes(), key);
  for (let i = 0; i < HASH_ROUNDS; i++) {
    h = Utilities.computeHmacSha256Signature(h, key);
  }
  return Utilities.base64Encode(h);
}

function checkThrottle_(key) {
  const n = Number(CacheService.getScriptCache().get('f_' + key) || 0);
  if (n >= MAX_LOGIN_FAILS) throw new Error('ログインに続けて失敗したため、10分ほど待ってから再度お試しください。');
}
function addFail_(key) {
  const c = CacheService.getScriptCache();
  c.put('f_' + key, String(Number(c.get('f_' + key) || 0) + 1), 600);
}
function clearFail_(key) {
  CacheService.getScriptCache().remove('f_' + key);
}

function validateLoginId_(v) {
  if (!/^[a-z0-9_.-]{3,30}$/.test(v)) throw new Error('ログインIDは半角英数字（記号は _ . - のみ）で3〜30文字にしてください。');
}
function validateName_(v) {
  if (!v || v.length > 30) throw new Error('表示名は1〜30文字で入力してください。');
}
function validatePassword_(v) {
  if (v.length < 8 || v.length > 64) throw new Error('パスワードは8〜64文字にしてください。');
}
function validateEmail_(v) {
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('メールアドレスの形式が正しくありません。');
}

function publicUser_(u) {
  return {
    id: u.id, loginId: u.loginId, name: u.name, email: u.email,
    role: u.role, territoryAdmin: u.territoryAdmin === '1', calendarEditor: u.calendarEditor === '1',
    digest: u.digestOff !== '1',
    features: appFeatures_()
  };
}
function adminUser_(u) {
  const p = publicUser_(u);
  p.active = u.active === '1';
  p.withdrawnAt = u.withdrawnAt || '';
  p.createdAt = u.createdAt;
  p.lastLoginAt = u.lastLoginAt;
  return p;
}

// ===== シート読み書き =====
// 1回の処理（通信1回）の中では、同じシートは1度だけ読み込む
const sheetCache_ = {};
const rowsCache_ = {};
const headerChecked_ = {};
let ss_ = null;

function spreadsheet_() {
  if (!ss_) ss_ = SpreadsheetApp.getActiveSpreadsheet();
  return ss_;
}

function sheet_(name) {
  if (sheetCache_[name]) return sheetCache_[name];
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    if (!SHEETS[name]) throw new Error('シート「' + name + '」がありません。');
    // 新しい機能のシートは自動で作成
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (SHEETS[name] && !headerChecked_[name]) {
    // 機能追加で列が増えた場合、見出しを自動で追加
    const want = SHEETS[name];
    const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    const ok = want.every(function (h, i) { return have[i] === h; });
    if (!ok) sh.getRange(1, 1, 1, want.length).setValues([want]).setFontWeight('bold');
  }
  headerChecked_[name] = true;
  sheetCache_[name] = sh;
  return sh;
}

function readRows_(name) {
  if (rowsCache_[name]) return rowsCache_[name];
  const values = sheet_(name).getDataRange().getValues();
  const headers = values.shift() || [];
  const out = [];
  values.forEach(function (r, i) {
    if (r[0] === '' || r[0] === null) return;
    const o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = r[j] === null ? '' : String(r[j]); });
    out.push(o);
  });
  rowsCache_[name] = out;
  return out;
}

function appendRow_(name, obj) {
  sheet_(name).appendRow(SHEETS[name].map(function (h) { return cell_(obj[h]); }));
  delete rowsCache_[name];
}

function updateRow_(name, row, obj) {
  const headers = SHEETS[name];
  sheet_(name).getRange(row, 1, 1, headers.length)
    .setValues([headers.map(function (h) { return cell_(obj[h]); })]);
  delete rowsCache_[name];
}

// 行の削除（下から消して行番号のずれを防ぐ）
function deleteRows_(name, rowNums) {
  if (!rowNums.length) return;
  const sh = sheet_(name);
  rowNums.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  delete rowsCache_[name];
}

// 先頭に ' を付けて文字列として保存（数式や数値への自動変換を防ぐ）
function cell_(v) {
  if (v === undefined || v === null || v === '') return '';
  return "'" + String(v);
}

function nowIso_() {
  return new Date().toISOString();
}

function randomToken_() {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now() + Math.random());
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function randomCode_(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now() + Math.random());
  let s = '';
  for (let i = 0; i < len; i++) s += chars[(bytes[i] & 0xff) % chars.length];
  return s;
}
