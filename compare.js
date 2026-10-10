'use strict';

// Only public exchange rates leave the browser. Store prices stay in memory.
const COMPARISON_P2P_SAMPLE_SIZE = 10;
const BINANCE_SELL_ADS = `https://www.binance.com/bapi/c2c/v1/public/c2c/agent/ad-list?fiat=VES&asset=USDT&tradeType=SELL&limit=${COMPARISON_P2P_SAMPLE_SIZE}`;
const COMPARISON_QUOTE_MAX_AGE = 5 * 60 * 1000;
const COMPARISON_MAX_DIGITS = 12;
const COMPARISON_BCV_HISTORY_LOOKBACK_DAYS = 14;
const comparisonEntries = { cash: '', bcv: '', bolivares: '' };
let comparisonBcv = null;
let comparisonBcvState = 'idle';
let comparisonBcvCheckedDate = null;
let comparisonQuote = null;
let comparisonQuoteState = 'idle';
let comparisonLoading = false;
let comparisonRequest = 0;
let comparisonLastInput = null;

function hasComparisonEdits() {
  return Object.values(comparisonEntries).some(digits => digits.length > 0);
}

function comparisonEntryKey(inputId) {
  if (inputId === 'cashPrice') return 'cash';
  return $('equivalentBcvToggle').checked ? 'bcv' : 'bolivares';
}

function comparisonAmount(key) {
  return comparisonEntries[key] === '' ? null : Number(comparisonEntries[key]) / 100;
}

function renderPriceInput(inputId) {
  const input = $(inputId);
  const digits = comparisonEntries[comparisonEntryKey(inputId)];
  input.value = digits === '' ? '' : fmt(Number(digits) / 100);
  if (document.activeElement === input) input.setSelectionRange(input.value.length, input.value.length);
}

function comparisonTime(isoDate) {
  const date = new Date(isoDate);
  if (!Number.isFinite(date.getTime())) return 'Hora no disponible';
  return date.toLocaleString('es-VE', {
    timeZone: 'America/Caracas', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

function normalizeComparisonBcv(data, latestDate) {
  const effectiveDate = data?.effective_date || data?.source_date || data?.date;
  if (typeof effectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return null;
  const parsedDate = new Date(`${effectiveDate}T12:00:00Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== effectiveDate
    || effectiveDate > latestDate || !Number.isFinite(data.USD) || data.USD <= 0) return null;
  return {
    USD: data.USD, date: effectiveDate, effective_date: effectiveDate,
    source_date: data.source_date || data.date || effectiveDate,
    updated_at: data.updated_at && Number.isFinite(new Date(data.updated_at).getTime()) ? data.updated_at : null
  };
}

function latestComparisonBcv(first, second) {
  if (!first) return second;
  if (!second) return first;
  if (second.date > first.date || (second.date === first.date
    && (Date.parse(second.updated_at) || 0) > (Date.parse(first.updated_at) || 0))) return second;
  return first;
}

function readLatestComparisonBcv(date) {
  let latest = normalizeComparisonBcv(comparisonBcv, date);
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(CACHE_PREFIX)) continue;
      try {
        const cached = normalizeComparisonBcv(JSON.parse(localStorage.getItem(key)), date);
        latest = latestComparisonBcv(latest, cached);
      } catch (error) {}
    }
  } catch (error) {}
  return latest;
}

function comparisonBcvIsUsable() {
  return ['live', 'reference', 'saved'].includes(comparisonBcvState)
    && comparisonBcv && comparisonBcv.date <= todayInCaracas();
}

function comparisonBcvIsReference() {
  return Boolean(comparisonBcv && (comparisonBcv.date !== todayInCaracas() || comparisonBcvState === 'saved'));
}

function comparisonBcvNeedsRefresh() {
  return comparisonBcvCheckedDate !== todayInCaracas() || !['live', 'reference'].includes(comparisonBcvState);
}

function comparisonQuoteIsCurrent() {
  return comparisonQuoteState === 'live' && comparisonQuote
    && Date.now() - comparisonQuote.observedAt < COMPARISON_QUOTE_MAX_AGE;
}

function renderComparisonRates() {
  $('comparisonBcvValue').textContent = comparisonBcv ? `Bs ${fmt(roundRateUpToCents(comparisonBcv.USD))}` : '—';
  $('comparisonBcvDate').textContent = comparisonBcv
    ? `${comparisonBcvState === 'saved' ? 'Guardada' : comparisonBcvIsReference() ? 'Referencia' : 'Fecha'}: ${formatDate(comparisonBcv.date)}`
    : `Fecha: ${formatDate(todayInCaracas())}`;
  $('comparisonBcvDate').classList.toggle('is-reference', comparisonBcvIsReference());
  $('comparisonBcvReference').textContent = comparisonBcv
    ? comparisonBcvState === 'saved'
      ? `No se pudo confirmar un dato nuevo con la fuente. Se usa la última tasa guardada, del ${formatDate(comparisonBcv.date)}, como referencia.`
      : comparisonBcvIsReference()
        ? `Se usa la última tasa disponible para hoy o una fecha anterior, del ${formatDate(comparisonBcv.date)}, como referencia. No es una tasa nueva de hoy.`
        : `La tasa corresponde al ${formatDate(comparisonBcv.date)}.`
    : 'No hay una tasa BCV disponible para utilizar como referencia.';
  $('comparisonBcvUpdated').textContent = comparisonBcv?.updated_at
    ? `Registrada por la API: ${comparisonTime(comparisonBcv.updated_at)} · Venezuela`
    : comparisonBcvState === 'loading' ? 'Consultando…' : 'Hora de registro no disponible';

  $('comparisonUsdtValue').textContent = comparisonQuote ? `Bs ${fmt(comparisonQuote.price, 3)}` : '—';
  $('comparisonUsdtMethod').textContent = comparisonQuote
    ? `1 USDT · promedio de ${comparisonQuote.sampleCount}` : '1 USDT · promedio';
  $('comparisonUsdtSample').textContent = comparisonQuote
    ? `Promedio aritmético de ${comparisonQuote.sampleCount} anuncios para vender USDT. Rango: Bs ${fmt(comparisonQuote.minimum, 3)}–${fmt(comparisonQuote.maximum, 3)} por USDT. Sin filtro de banco ni monto.`
    : comparisonQuoteState === 'loading' ? 'Consultando hasta 10 anuncios para vender USDT…'
    : 'El promedio se calcula con hasta 10 anuncios disponibles para vender USDT.';
  $('comparisonUsdtDate').textContent = comparisonQuote
    ? `Consultada: ${new Date(comparisonQuote.observedAt).toLocaleString('es-VE', {
      timeZone: 'America/Caracas', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    })}`
    : comparisonQuoteState === 'loading' ? 'Consultando…' : 'Consulta pendiente';
  $('comparisonUsdtUpdated').textContent = comparisonQuote
    ? `Consultada: ${comparisonTime(comparisonQuote.observedAt)} · Venezuela`
    : comparisonQuoteState === 'loading' ? 'Consultando…' : 'Pendiente de consultar';

  const messages = [];
  if (comparisonBcvState === 'error') messages.push('No se pudo consultar BCV y no hay una tasa guardada como referencia.');
  if (comparisonBcvState === 'not-found') messages.push('La fuente no tiene una tasa BCV disponible para hoy ni una referencia anterior en la consulta.');
  if (comparisonQuoteState === 'error') messages.push('No se pudo actualizar el promedio de Binance. Revisa tu conexión o inténtalo de nuevo.');
  if (comparisonQuoteState === 'live' && !comparisonQuoteIsCurrent()) messages.push('La referencia de Binance tiene más de 5 minutos. Actualiza las tasas.');
  $('comparisonRateStatus').hidden = messages.length === 0;
  $('comparisonRateStatus').textContent = messages.join(' ');
  $('refreshComparison').disabled = comparisonLoading;
  $('refreshComparisonLabel').textContent = comparisonLoading ? 'Consultando…' : 'Actualizar';
  if (!$('comparisonPanel').hidden) {
    $('refreshButton').disabled = comparisonLoading;
    $('refreshButton').classList.toggle('spin', comparisonLoading);
    $('refreshButton').setAttribute('aria-label', 'Actualizar tasas BCV y Binance');
  }
}

function setComparisonMessage(title, description, warning = false, visuallyHidden = false) {
  $('comparisonResult').classList.toggle('is-empty', !warning);
  $('comparisonResult').classList.toggle('is-warning', warning);
  $('comparisonResult').classList.toggle('sr-only', visuallyHidden);
  delete $('comparisonResult').dataset.winner;
  $('comparisonVerdict').textContent = title;
  $('comparisonSaving').textContent = description;
  for (const [estimateId, statusId, savingId] of [
    ['cashEstimate', 'cashPaymentStatus', 'cashSaving'],
    ['localEstimate', 'localPaymentStatus', 'localSaving']
  ]) {
    $(estimateId).classList.remove('is-best', 'is-more-expensive');
    $(statusId).textContent = 'Por comparar';
    $(savingId).hidden = true;
  }
}

function updateComparison() {
  const bcvMode = $('equivalentBcvToggle').checked;
  const cash = comparisonAmount('cash');
  const local = comparisonAmount(bcvMode ? 'bcv' : 'bolivares');
  const canConvertBcv = comparisonBcvIsUsable();
  const usesBcvReference = bcvMode && comparisonBcvIsReference();
  const canConvertBinance = comparisonQuoteIsCurrent();
  const cashBs = cash !== null && canConvertBinance
    ? Math.round(cash * comparisonQuote.price * 100) / 100
    : null;
  const localBs = local !== null && (!bcvMode || canConvertBcv)
    ? Math.round((bcvMode ? local * comparisonBcv.USD : local) * 100) / 100
    : null;
  const localCents = localBs !== null && canConvertBinance
    ? Math.round(localBs / comparisonQuote.price * 100) : null;
  $('cashCost').textContent = cash !== null && cash > 0 ? fmt(cash) : '—';
  $('localCost').textContent = localCents !== null && localCents > 0 && Number.isSafeInteger(localCents)
    ? fmt(localCents / 100) : '—';
  $('localCostLabel').textContent = usesBcvReference ? 'Estimado' : 'Equivalente';

  $('localPriceLabel').textContent = bcvMode ? 'Precio en USD · tasa BCV' : 'Monto directo en bolívares';
  $('localPriceUnit').textContent = bcvMode ? 'USD' : 'Bs';
  $('localPriceHelp').textContent = bcvMode
    ? 'Escribe el precio en dólares; se convierte a bolívares.'
    : 'Escribe el monto final que la tienda cobra en bolívares.';
  $('cashPriceTotal').textContent = cashBs !== null ? `Bs ${fmt(cashBs)}`
    : cash === null ? '—'
    : comparisonLoading ? 'Consultando…' : 'Actualiza Binance';
  $('localPriceTotalLabel').textContent = bcvMode
    ? usesBcvReference ? 'Bs · referencia BCV' : 'Total en Bs · BCV'
    : 'Total en bolívares';
  $('localPriceTotal').textContent = localBs !== null ? `Bs ${fmt(localBs)}`
    : bcvMode && local !== null ? 'Tasa pendiente' : '—';
  renderComparisonRates();

  if (cash === null || local === null) {
    setComparisonMessage('', '', false, true);
    return;
  }
  if (cash <= 0 || local <= 0) {
    setComparisonMessage('Introduce precios mayores que cero', 'Completa el precio en dólares y la alternativa en bolívares.');
    return;
  }
  if ((bcvMode && !canConvertBcv) || !canConvertBinance) {
    setComparisonMessage(comparisonLoading ? 'Consultando las tasas…' : 'Actualiza las tasas para comparar',
      'El resultado necesita un promedio de Binance reciente' + (bcvMode ? ' y una tasa BCV disponible.' : '.'), !comparisonLoading, comparisonLoading);
    return;
  }

  const cashCents = Number(comparisonEntries.cash);
  if (!Number.isSafeInteger(localCents) || !Number.isSafeInteger(Math.round(localBs * 100))) {
    setComparisonMessage('El monto es demasiado alto', 'Introduce un precio menor para calcularlo con precisión.', true);
    return;
  }
  const difference = cashCents - localCents;
  const savings = Math.abs(difference) / 100;
  const percent = Math.abs(difference) / Math.max(cashCents, localCents) * 100;
  $('comparisonResult').classList.remove('is-empty', 'is-warning');
  $('comparisonResult').classList.add('sr-only');
  $('comparisonResult').dataset.winner = difference === 0 ? 'equal' : difference > 0 ? 'bolivares' : 'dollars';
  $('comparisonVerdict').textContent = difference === 0 ? 'Cuestan lo mismo'
    : difference > 0 ? 'Conviene pagar en bolívares' : 'Conviene pagar en dólares';
  $('comparisonSaving').textContent = difference === 0
    ? 'La diferencia es menor a un centavo con estas tasas.'
    : `Ahorro estimado: ${fmt(savings)} USDT (${fmt(percent)} %).`;
  if (usesBcvReference) $('comparisonSaving').textContent += ` Referencia BCV del ${formatDate(comparisonBcv.date)}.`;
  const cashWins = difference < 0;
  const localWins = difference > 0;
  $('cashEstimate').classList.toggle('is-best', cashWins);
  $('cashEstimate').classList.toggle('is-more-expensive', localWins);
  $('localEstimate').classList.toggle('is-best', localWins);
  $('localEstimate').classList.toggle('is-more-expensive', cashWins);
  $('cashPaymentStatus').textContent = difference === 0 ? 'Mismo costo' : cashWins ? 'Más barato' : 'Más caro';
  $('localPaymentStatus').textContent = difference === 0 ? 'Mismo costo' : localWins ? 'Más barato' : 'Más caro';
  $('cashSaving').hidden = !cashWins;
  $('localSaving').hidden = !localWins;
  $('cashSavingAmount').textContent = $('localSavingAmount').textContent = `${fmt(savings)} USDT`;
}

async function fetchComparisonJson(address) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(address, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timeout); }
}

async function fetchComparisonBcv(date) {
  let latestError = null;
  try {
    const latest = normalizeComparisonBcv(await fetchComparisonJson(`${API_ROOT}/rate.json`), date);
    if (latest) return latest;
  } catch (error) { latestError = error; }

  // The latest endpoint can already contain tomorrow's rate. Look backwards,
  // retaining the record's effective date rather than relabeling it as today.
  for (let offset = 0; offset <= COMPARISON_BCV_HISTORY_LOOKBACK_DAYS; offset++) {
    const historyDate = new Date(`${date}T12:00:00Z`);
    historyDate.setUTCDate(historyDate.getUTCDate() - offset);
    const day = historyDate.toISOString().slice(0, 10);
    const candidate = normalizeComparisonBcv(await fetchComparisonJson(`${API_ROOT}/history/${day}.json`), date);
    if (candidate) return candidate;
  }
  if (latestError) throw latestError;
  return null;
}

async function fetchComparisonUsdt() {
  // SELL is the user's side: sell USDT and receive VES, as documented by Binance.
  const data = await fetchComparisonJson(BINANCE_SELL_ADS);
  if (data?.success !== true || data.code !== '000000' || !Array.isArray(data.data?.items)) {
    throw new Error('Binance returned no valid ad list');
  }
  // Preserve Binance's result order and give each of the first ten ads equal weight.
  const items = data.data.items.slice(0, COMPARISON_P2P_SAMPLE_SIZE);
  if (items.length === 0) throw new Error('Binance returned no available USDT/VES ads');
  const prices = items.map(item => {
    const price = Number(item?.price);
    if (item?.asset !== 'USDT' || item.fiat !== 'VES' || !Number.isFinite(price) || price <= 0) {
      throw new Error('Binance returned an invalid price in the sample');
    }
    return price;
  });
  const price = prices.reduce((sum, value) => sum + value, 0) / prices.length;
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid P2P average');
  // Keep only price statistics. Advertiser and payment details stay out of app state.
  return {
    price, sampleCount: prices.length, minimum: Math.min(...prices), maximum: Math.max(...prices),
    observedAt: Date.now()
  };
}

async function loadComparisonRates() {
  if (comparisonLoading) return;
  const request = ++comparisonRequest;
  const date = todayInCaracas();
  comparisonLoading = true;
  comparisonBcv = readLatestComparisonBcv(date);
  comparisonBcvState = 'loading';
  comparisonQuoteState = 'loading';
  updateComparison();

  const results = await Promise.allSettled([fetchComparisonBcv(date), fetchComparisonUsdt()]);
  if (request !== comparisonRequest) return;
  const [bcvResult, usdtResult] = results;
  if (bcvResult.status === 'fulfilled' && bcvResult.value) {
    comparisonBcv = bcvResult.value;
    comparisonBcvState = comparisonBcv.date === date ? 'live' : 'reference';
    comparisonBcvCheckedDate = date;
    try { localStorage.setItem(CACHE_PREFIX + comparisonBcv.date, JSON.stringify(comparisonBcv)); } catch (error) {}
  } else {
    comparisonBcv = readLatestComparisonBcv(date);
    comparisonBcvState = comparisonBcv ? 'saved' : bcvResult.status === 'fulfilled' ? 'not-found' : 'error';
  }
  if (usdtResult.status === 'fulfilled') {
    comparisonQuote = usdtResult.value;
    comparisonQuoteState = 'live';
  } else comparisonQuoteState = 'error';
  comparisonLoading = false;
  updateComparison();
}

function showFinanceModule(moduleName, focusTab = false) {
  closeMoneyKeypad();
  const compare = moduleName === 'comparison';
  const focusedInput = document.activeElement;
  if (focusedInput?.tagName === 'INPUT') focusedInput.blur();
  $('calculatorPanel').hidden = compare;
  $('comparisonPanel').hidden = !compare;
  document.querySelector('.page').dataset.module = moduleName;
  $('calculatorTab').setAttribute('aria-selected', String(!compare));
  $('comparisonTab').setAttribute('aria-selected', String(compare));
  $('calculatorTab').tabIndex = compare ? -1 : 0;
  $('comparisonTab').tabIndex = compare ? 0 : -1;
  if (focusTab) $(compare ? 'comparisonTab' : 'calculatorTab').focus({ preventScroll: true });
  if (compare) {
    updateComparison();
    if (!comparisonLoading && (comparisonBcvNeedsRefresh() || !comparisonQuoteIsCurrent())) loadComparisonRates();
  } else {
    $('refreshButton').setAttribute('aria-label', 'Actualizar tasa de la fecha seleccionada');
    updateView();
  }
}

function applyComparisonKey(inputId, key) {
  const entryKey = comparisonEntryKey(inputId);
  if (key === 'delete') comparisonEntries[entryKey] = comparisonEntries[entryKey].slice(0, -1);
  else if (/^\d$/.test(key)) comparisonEntries[entryKey] = (comparisonEntries[entryKey] + key)
    .replace(/^0+(?=\d)/, '').slice(0, COMPARISON_MAX_DIGITS);
  renderPriceInput(inputId);
  updateComparison();
}

['cashPrice', 'localPrice'].forEach(inputId => {
  const input = $(inputId);
  input.addEventListener('focus', () => {
    comparisonLastInput = inputId;
    input.setSelectionRange(input.value.length, input.value.length);
  });
  input.addEventListener('contextmenu', event => event.preventDefault());
  input.addEventListener('paste', event => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text') || '';
    const amount = /\d/.test(text) ? parseAmount(text) : null;
    const cents = amount === null ? null : Math.round(amount * 100);
    if (cents === null || !Number.isSafeInteger(cents) || String(cents).length > COMPARISON_MAX_DIGITS) return;
    comparisonEntries[comparisonEntryKey(inputId)] = String(cents);
    renderPriceInput(inputId);
    updateComparison();
  });
});

$('equivalentBcvToggle').addEventListener('change', () => {
  // Keep the USD and Bs alternatives separate so switching never reinterprets a price.
  renderPriceInput('localPrice');
  updateComparison();
  refreshMoneyKeypad();
});
$('resetComparison').addEventListener('pointerdown', event => {
  if (document.activeElement === $('cashPrice') || document.activeElement === $('localPrice')) event.preventDefault();
});
$('resetComparison').addEventListener('click', () => {
  Object.keys(comparisonEntries).forEach(key => { comparisonEntries[key] = ''; });
  renderPriceInput('cashPrice');
  renderPriceInput('localPrice');
  updateComparison();
  if (comparisonLastInput) $(comparisonLastInput).focus({ preventScroll: true });
});
$('refreshComparison').addEventListener('click', loadComparisonRates);
$('calculatorTab').addEventListener('click', () => showFinanceModule('calculator'));
$('comparisonTab').addEventListener('click', () => showFinanceModule('comparison'));
document.querySelector('.module-nav').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const moduleName = event.key === 'Home' ? 'calculator' : event.key === 'End' ? 'comparison'
    : $('comparisonPanel').hidden ? 'comparison' : 'calculator';
  showFinanceModule(moduleName, true);
});
window.addEventListener('online', () => {
  if (!$('comparisonPanel').hidden) loadComparisonRates();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('comparisonPanel').hidden) {
    updateComparison();
    if (!comparisonLoading && (comparisonBcvNeedsRefresh() || !comparisonQuoteIsCurrent())) loadComparisonRates();
  }
});
setInterval(() => {
  if (document.visibilityState === 'visible' && !$('comparisonPanel').hidden) {
    updateComparison();
    if (!comparisonLoading && comparisonBcvCheckedDate && comparisonBcvCheckedDate !== todayInCaracas()) loadComparisonRates();
  }
}, 30000);
updateComparison();
