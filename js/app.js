const STORAGE_KEY = 'blink_ro_api_key';
const COMMENT_SERVER_KEY = 'comment_server_url';
const ENDPOINT = 'https://api.blink.sv/graphql';

const $modal = document.getElementById('api-modal');
const $keyInput = document.getElementById('api-key-input');
const $commentServerInput = document.getElementById('comment-server-input');
const $modalErr = document.getElementById('modal-err');
const $day = document.getElementById('day');
const $fetch = document.getElementById('fetch');
const $settings = document.getElementById('settings');
const $rangeHint = document.getElementById('range-hint');
const $summary = document.getElementById('summary');
const $warnings = document.getElementById('warnings');
const $fetchErr = document.getElementById('fetch-err');
const $list = document.getElementById('list');
const $empty = document.getElementById('empty');

function localDateInputValue(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Selected local calendar day × [midnight … min(now, end of day)] in Unix seconds */
function dayUnixRange(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
  const now = new Date();
  if (start.getTime() > now.getTime()) {
    const unreachable = Math.floor(now.getTime() / 1000) + 2;
    return {
      fromSec: unreachable,
      toSec: unreachable - 3,
      start,
      end: start,
    };
  }
  const end = endOfDay.getTime() <= now.getTime() ? endOfDay : now;
  const fromSec = Math.floor(start.getTime() / 1000);
  const toSec = Math.floor(end.getTime() / 1000);
  return { fromSec, toSec, start, end };
}

let inMemoryApiKey = '';
try {
  inMemoryApiKey = localStorage.getItem(STORAGE_KEY) || '';
} catch {
  inMemoryApiKey = '';
}

let inMemoryCommentServer = '';
try {
  inMemoryCommentServer = localStorage.getItem(COMMENT_SERVER_KEY) || '';
} catch {
  inMemoryCommentServer = '';
}

function getApiKey() {
  if (inMemoryApiKey) return inMemoryApiKey;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setApiKey(v) {
  inMemoryApiKey = v;
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    // Some browser contexts can block storage; keep key in memory for this session.
  }
}

function normalizeCommentServerUrl(v) {
  const raw = (v ?? '').trim();
  return raw.replace(/\/+$/, '');
}

function getCommentServer() {
  if (inMemoryCommentServer) return inMemoryCommentServer;
  try {
    return localStorage.getItem(COMMENT_SERVER_KEY);
  } catch {
    return null;
  }
}

function setCommentServer(v) {
  const norm = normalizeCommentServerUrl(v);
  inMemoryCommentServer = norm;
  try {
    localStorage.setItem(COMMENT_SERVER_KEY, norm);
  } catch {
    // Some browser contexts can block storage; keep value in memory for this session.
  }
}

async function gql(apiKey, query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey.trim(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || `HTTP ${res.status}`);
  }
  if (json.errors && json.errors.length) {
    const msg = json.errors.map((e) => e.message).join('; ');
    throw new Error(msg);
  }
  return json.data;
}

const Q_ME_WALLETS = `
  query MeWallets {
    me {
      id
      defaultAccount {
        id
        wallets {
          __typename
          id
          walletCurrency
          balance
        }
      }
    }
  }
`;

const Q_TX_PAGE = `
  query TxPage($first: Int!, $after: String, $walletIds: [WalletId]) {
    me {
      defaultAccount {
        transactions(first: $first, after: $after, walletIds: $walletIds) {
          pageInfo { hasNextPage endCursor }
          edges {
            cursor
            node {
              id
              createdAt
              direction
              status
              memo
              settlementAmount
              settlementCurrency
              settlementFee
              initiationVia {
                __typename
                ... on InitiationViaIntraLedger {
                  counterPartyUsername
                }
                ... on InitiationViaLn {
                  paymentHash
                }
                ... on InitiationViaOnChain {
                  address
                }
              }
              settlementVia {
                __typename
                ... on SettlementViaOnChain {
                  transactionHash
                  vout
                }
              }
            }
          }
        }
      }
    }
  }
`;

function formatIx(iv) {
  if (!iv) return [];
  switch (iv.__typename) {
    case 'InitiationViaIntraLedger':
      return [['Counterparty', iv.counterPartyUsername]].filter(([_, v]) => v);
    case 'InitiationViaLn':
      return [
        ['LN payment hash', iv.paymentHash],
      ].filter(([_, v]) => v);
    case 'InitiationViaOnChain':
      return [['On-chain address', iv.address]].filter(([_, v]) => v);
    default:
      return [];
  }
}

function formatSv(sv) {
  if (!sv) return [];
  switch (sv.__typename) {
    case 'SettlementViaOnChain':
      return [['Tx hash', sv.transactionHash], ['vout', sv.vout != null ? String(sv.vout) : '']].filter(([_, v]) => v);
    default:
      return [];
  }
}

function showModal(mustDismiss) {
  $modal.hidden = false;
  $modalErr.hidden = true;
  $keyInput.value = '';
  $commentServerInput.value = getCommentServer() || '';
  $keyInput.focus();
  window._modalMandatory = !!mustDismiss;
}

function hideModal(force = false) {
  if (!force && window._modalMandatory && !getApiKey()) return;
  $modal.hidden = true;
}

async function validateAndSaveKey() {
  const maybeKey = $keyInput.value.trim();
  const commentServer = normalizeCommentServerUrl($commentServerInput.value);

  if (window._modalMandatory && !maybeKey && !getApiKey()) {
    $modalErr.textContent = 'Enter your API key.';
    $modalErr.hidden = false;
    return;
  }

  try {
    if (maybeKey) {
      await gql(maybeKey, Q_ME_WALLETS, {});
      setApiKey(maybeKey);
    }
    setCommentServer(commentServer);
    hideModal(true);
    updateRangeHint();
  } catch (e) {
    $modalErr.textContent = e.message || String(e);
    $modalErr.hidden = false;
  }
}

function updateRangeHint() {
  const { fromSec, toSec, start, end } = dayUnixRange($day.value);
  const opts = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  $rangeHint.textContent =
    `Including transactions from ${start.toLocaleString(undefined, opts)} to ${end.toLocaleString(undefined, opts)} (local). ` +
    `Unix: ${fromSec} – ${toSec}.`;
}

function fmtNum(n) {
  const x = typeof n === 'number' ? n : parseFloat(String(n).replace(',', ''));
  return Number.isFinite(x) ? x.toLocaleString() : String(n);
}

function fmtUsd(centsMaybe) {
  const x = typeof centsMaybe === 'number' ? centsMaybe : parseFloat(String(centsMaybe));
  if (!Number.isFinite(x)) return String(centsMaybe);
  return (x / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function parseOraMemo(memo) {
  const s = memo == null ? '' : String(memo).trim();
  if (!s) return null;
  const m = s.match(/^Φ\s*([0-9]+(?:\.[0-9]+)?)\s*#\s*(.+?)\s*$/);
  if (!m) return null;
  const amt = Number(m[1]);
  const merk = String(m[2] || '').trim();
  if (!Number.isFinite(amt) || amt <= 0 || !merk) return null;
  return { ora: amt, merk };
}

function renderTx(tx) {
  const cur = tx.settlementCurrency;
  let satPart = '';

  if (cur === 'BTC') {
    satPart = `${fmtNum(tx.settlementAmount)} sat`;
  } else {
    satPart = `${fmtUsd(tx.settlementAmount)} USD`;
  }

  const extraMeta = [...formatIx(tx.initiationVia), ...formatSv(tx.settlementVia)];
  const noteParts = [];

  noteParts.push({ k: 'Memo', v: tx.memo == null ? '' : String(tx.memo) });
  extraMeta.forEach(([k, v]) => noteParts.push({ k, v }));

  const notesHtml = noteParts
    .filter((x) => x.k === 'Memo' || x.v)
    .map((x) => `<div><span class="k">${escapeHtml(x.k)}:</span>${escapeHtml(x.v)}</div>`)
    .join('');

  const dt = new Date(tx.createdAt * 1000);
  const pillClass = cur === 'BTC' ? 'btc' : 'usd';

  return `<li class="tx">
    <div class="tx-head">
      <span>${escapeHtml(dt.toLocaleString())}</span>
      <span class="pill ${pillClass}">${escapeHtml(cur)} wallet</span>
    </div>
    <div class="amounts">
      <span><strong>Settled</strong>: ${escapeHtml(satPart)}</span>
    </div>
    ${notesHtml ? `<div class="notes">${notesHtml}</div>` : ''}
  </li>`;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function fetchCommentForPaymentHash(baseUrl, paymentHash) {
  const base = normalizeCommentServerUrl(baseUrl);
  if (!base || !paymentHash) return null;
  try {
    const url = `${base}/get?code=${encodeURIComponent(paymentHash)}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const json = await res.json();
    const c = json && typeof json.comment === 'string' ? json.comment.trim() : '';
    return c ? c : null;
  } catch {
    return null;
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runFetch() {
  const apiKey = getApiKey();
  if (!apiKey) {
    showModal(true);
    return;
  }
  $fetch.disabled = true;
  $fetchErr.hidden = true;
  $summary.hidden = true;
  $warnings.hidden = true;
  $warnings.innerHTML = '';

  try {
    const { fromSec, toSec } = dayUnixRange($day.value);
    let after = null;
    const collected = [];
    const BATCH = 50;

    while (true) {
      const data = await gql(apiKey, Q_TX_PAGE, {
        first: BATCH,
        after,
        walletIds: null,
      });
      const conn = data?.me?.defaultAccount?.transactions;
      const edges = conn?.edges || [];
      let oldestInBatch = Infinity;

      for (const edge of edges) {
        const n = edge.node;
        oldestInBatch = Math.min(oldestInBatch, n.createdAt);
        if (n.createdAt <= toSec && n.createdAt >= fromSec) {
          collected.push(n);
        }
      }

      const hasNext = conn?.pageInfo?.hasNextPage;
      after = conn?.pageInfo?.endCursor;

      // Newest-first: stop once the batch is entirely older than window start
      if (!hasNext || !after || (edges.length && oldestInBatch < fromSec)) break;
    }

    // Only successful incoming.
    const incoming = collected.filter((t) => t && t.status === 'SUCCESS' && t.direction === 'RECEIVE');

    // Oldest → newest.
    incoming.sort((a, b) => a.createdAt - b.createdAt);

    const commentServer = getCommentServer();
    if (commentServer) {
      const missingMemo = incoming
        .filter((t) => (t.memo == null || String(t.memo).trim() === ''))
        .filter((t) => t?.initiationVia?.__typename === 'InitiationViaLn' && t?.initiationVia?.paymentHash);

      if (missingMemo.length) {
        const fetched = await mapWithConcurrency(missingMemo, 8, async (t) => {
          const ph = t.initiationVia.paymentHash;
          const comment = await fetchCommentForPaymentHash(commentServer, ph);
          return { txId: t.id, comment };
        });

        const byId = new Map(fetched.map((x) => [x.txId, x.comment]));
        for (const t of incoming) {
          if (t.memo == null || String(t.memo).trim() === '') {
            if (t?.initiationVia?.__typename === 'InitiationViaLn' && t?.initiationVia?.paymentHash) {
              const c = byId.get(t.id);
              t.memo = c || 'no comment available';
            }
          }
        }
      }
    }

    const valid = [];
    const warnings = [];
    for (const t of incoming) {
      const parsed = parseOraMemo(t.memo);
      if (!parsed) warnings.push(t);
      else valid.push({ ...t, _ora: parsed.ora, _merk: parsed.merk });
    }

    const totalsBtcSat = valid
      .filter((t) => t.settlementCurrency === 'BTC')
      .reduce((s, t) => s + (Number(t.settlementAmount) || 0), 0);
    const totalsOra = valid.reduce((s, t) => s + (Number(t._ora) || 0), 0);

    $summary.innerHTML =
      `<div><strong>Summary</strong></div>` +
      `<div class="grid">` +
      `<div><div class="metric">Transactions</div><div class="value">${escapeHtml(String(valid.length))}</div></div>` +
      `<div><div class="metric">Total sats</div><div class="value">${escapeHtml(fmtNum(totalsBtcSat))}</div></div>` +
      `<div><div class="metric">Total Ora</div><div class="value">${escapeHtml(String(totalsOra))}</div></div>` +
      `</div>`;
    $summary.hidden = false;

    const groups = new Map();
    for (const t of valid) {
      const k = t._merk;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const groupEntries = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));

    $list.innerHTML = groupEntries
      .map(([merk, items]) => {
        const sats = items
          .filter((t) => t.settlementCurrency === 'BTC')
          .reduce((s, t) => s + (Number(t.settlementAmount) || 0), 0);
        const ora = items.reduce((s, t) => s + (Number(t._ora) || 0), 0);
        return `<li>
          <details class="group">
            <summary>
              <span><strong>${escapeHtml(merk)}</strong> <span class="meta">(${escapeHtml(String(items.length))} tx)</span></span>
              <span class="meta">${escapeHtml(fmtNum(sats))} sat · ${escapeHtml(String(ora))} Ora</span>
            </summary>
            <ul class="tx-list">${items.map(renderTx).join('')}</ul>
          </details>
        </li>`;
      })
      .join('');

    if (warnings.length) {
      $warnings.innerHTML =
        `<div class="warning-wrap">` +
        `<div class="warning-title">Warnings (not counted)</div>` +
        `<div class="muted">Memo must look like <strong>Φ{amount} #{merk}</strong>.</div>` +
        `<ul>` +
        warnings
          .map((t) => {
            const dt = new Date(t.createdAt * 1000);
            const memo = t.memo == null ? '' : String(t.memo);
            const ph = t?.initiationVia?.__typename === 'InitiationViaLn' ? t?.initiationVia?.paymentHash : '';
            const parts = [
              `${dt.toLocaleString()} · ${t.settlementCurrency === 'BTC' ? `${fmtNum(t.settlementAmount)} sat` : `${fmtUsd(t.settlementAmount)} USD`}`,
              memo ? `memo: ${memo}` : 'memo: (empty)',
              ph ? `paymentHash: ${ph}` : '',
            ].filter(Boolean);
            return `<li>${escapeHtml(parts.join(' · '))}</li>`;
          })
          .join('') +
        `</ul></div>`;
      $warnings.hidden = false;
    }

    $empty.textContent =
      incoming.length === 0
        ? 'No incoming successful transactions in this time range.'
        : valid.length === 0
          ? 'No valid Ora memos found in this time range.'
          : '';
    $empty.style.display = (incoming.length && valid.length) ? 'none' : 'block';
  } catch (e) {
    $fetchErr.textContent = e.message || String(e);
    $fetchErr.hidden = false;
    $empty.textContent = '';
  } finally {
    $fetch.disabled = false;
  }
}

document.getElementById('modal-save').onclick = validateAndSaveKey;
document.getElementById('modal-cancel').onclick = hideModal;

$settings.onclick = () => showModal(false);

$day.value = localDateInputValue();
$day.addEventListener('change', updateRangeHint);
updateRangeHint();

$fetch.onclick = () => runFetch();

if (!getApiKey()) {
  showModal(true);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  });
}
