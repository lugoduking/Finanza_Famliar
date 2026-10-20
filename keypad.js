'use strict';

// Native amount inputs stay readonly. This also prevents a phone from opening its keyboard.
const moneyKeypadFields = {
  usdAmount: {
    select: () => selectCurrency('USD'),
    label: () => 'USD · Dólares',
    write: key => applyCalculatorKey('USD', key)
  },
  vesAmount: {
    select: () => selectCurrency('VES'),
    label: () => 'Bs · Bolívares',
    write: key => applyCalculatorKey('VES', key)
  },
  cashPrice: {
    select: () => { comparisonLastInput = 'cashPrice'; return true; },
    label: () => 'USD · Precio en efectivo',
    write: key => applyComparisonKey('cashPrice', key)
  },
  localPrice: {
    select: () => { comparisonLastInput = 'localPrice'; return true; },
    label: () => $('equivalentBcvToggle').checked ? 'USD · Precio a tasa BCV' : 'Bs · Precio directo',
    write: key => applyComparisonKey('localPrice', key)
  }
};
let moneyKeypadTarget = null;
let quickCalculationOpen = false;
let quickCalculationExpression = '';
const QUICK_CALCULATION_MAX_LENGTH = 80;
const QUICK_CALCULATION_MAX_CENTS = 999999999999999n;

function isConverterKeypadTarget() {
  return moneyKeypadTarget === 'usdAmount' || moneyKeypadTarget === 'vesAmount';
}

function hasQuickCalculationDraft() {
  return quickCalculationOpen && quickCalculationExpression.length > 0;
}

// Parse only numbers and the four arithmetic operators. Exact fractions avoid
// floating-point errors; round once to cents when committing the final result.
function evaluateQuickCalculation(expression) {
  if (!expression || /[+\-*/]$/.test(expression)) return { cents: null, display: '—', message: 'Completa la operación.', error: false };
  const tokens = expression.match(/\d+(?:\.\d*)?|[+\-*/]/g);
  if (!tokens || tokens.join('') !== expression || expression.length > QUICK_CALCULATION_MAX_LENGTH) {
    return { cents: null, display: 'Revisa la cuenta', message: 'Escribe números y operaciones válidas.', error: true };
  }
  function fraction(numerator, denominator = 1n) {
    let first = numerator < 0n ? -numerator : numerator;
    let second = denominator;
    while (second) { const remainder = first % second; first = second; second = remainder; }
    return { numerator: numerator / first, denominator: denominator / first };
  }
  function operate(left, right, operator) {
    if (operator === '/' && right.numerator === 0n) throw new Error('No se puede dividir entre 0');
    if (operator === '*') return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
    if (operator === '/') return fraction(left.numerator * right.denominator, left.denominator * right.numerator);
    return fraction(left.numerator * right.denominator + (operator === '+' ? 1n : -1n) * right.numerator * left.denominator,
      left.denominator * right.denominator);
  }
  let cursor = 0;
  function readNumber() {
    const token = tokens[cursor++];
    if (!token || !/^\d+(?:\.\d*)?$/.test(token)) throw new Error('Revisa la cuenta');
    const [whole, decimals = ''] = token.split('.');
    if (whole.length + decimals.length > 15 || decimals.length > 2) throw new Error('Número demasiado largo');
    return fraction(BigInt(whole + decimals), 10n ** BigInt(decimals.length));
  }
  function readProduct() {
    let value = readNumber();
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const operator = tokens[cursor++];
      value = operate(value, readNumber(), operator);
    }
    return value;
  }
  try {
    let value = readProduct();
    while (cursor < tokens.length) {
      const operator = tokens[cursor++];
      if (operator !== '+' && operator !== '-') throw new Error('Revisa la cuenta');
      value = operate(value, readProduct(), operator);
    }
    if (value.numerator < 0n) return { cents: null, display: 'Resultado negativo', message: 'El monto debe ser cero o mayor. Corrige la cuenta antes de enviarla.', error: true };
    const scaled = value.numerator * 100n;
    const rounded = (scaled + value.denominator / 2n) / value.denominator;
    if (rounded > QUICK_CALCULATION_MAX_CENTS) return { cents: null, display: 'Monto demasiado alto', message: 'Reduce el monto para enviarlo al campo.', error: true };
    const cents = Number(rounded);
    return { cents, display: `= ${fmt(cents / 100)}`, message: 'Enviar coloca el resultado en el campo seleccionado.', error: false };
  } catch (error) {
    return { cents: null, display: error.message, message: `${error.message}. Corrige la cuenta antes de enviarla.`, error: true };
  }
}

function refreshQuickCalculation() {
  const available = !$('moneyKeypad').hidden && isConverterKeypadTarget();
  const open = available && quickCalculationOpen;
  if (!available) { quickCalculationOpen = false; quickCalculationExpression = ''; }
  document.querySelector('.page').dataset.quickCalculatorOpen = String(open);
  $('moneyKeypad').dataset.calculating = String(open);
  $('quickCalculator').hidden = !open;
  $('keypadCalculateButton').hidden = !available || open;
  $('keypadCalculateButton').setAttribute('aria-expanded', String(open));
  $('keypadDecimalButton').hidden = !open;
  $('keypadDoneButton').hidden = open;
  $('keypadResetButton').hidden = open;
  document.querySelectorAll('[data-calculation-only]').forEach(button => { button.hidden = !open; });
  const result = evaluateQuickCalculation(quickCalculationExpression);
  $('quickCalculatorSendButton').disabled = result.cents === null;
  if (!open) return;
  const input = $('quickCalculatorExpression');
  input.value = quickCalculationExpression.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\+/g, ' + ').replace(/-/g, ' − ').replace(/\./g, ',');
  input.scrollLeft = input.scrollWidth;
  $('quickCalculatorResult').textContent = result.display;
  $('quickCalculatorResult').classList.toggle('is-error', result.error);
  $('quickCalculatorResult').title = result.message;
  $('quickCalculatorNotice').textContent = result.message;
}

function closeQuickCalculation() {
  const returnFocus = $('quickCalculator').contains(document.activeElement);
  quickCalculationOpen = false;
  quickCalculationExpression = '';
  refreshMoneyKeypad();
  if (returnFocus && moneyKeypadTarget) $(moneyKeypadTarget).focus({ preventScroll: true });
}

function writeQuickCalculation(key) {
  const previousExpression = quickCalculationExpression;
  if (key === 'delete') quickCalculationExpression = quickCalculationExpression.slice(0, -1);
  else if (key === 'reset') quickCalculationExpression = '';
  else if (/^[+\-*/]$/.test(key)) {
    if (!quickCalculationExpression) return;
    quickCalculationExpression = quickCalculationExpression.replace(/[+\-*/]$/, '') + key;
  } else if (key === 'decimal' || /^\d$/.test(key)) {
    const currentNumber = quickCalculationExpression.match(/\d+(?:\.\d*)?$/)?.[0] || '';
    if (key === 'decimal') {
      if (currentNumber.includes('.')) return;
      quickCalculationExpression += currentNumber ? '.' : '0.';
    } else {
      if (currentNumber.replace('.', '').length >= 15 || (currentNumber.includes('.') && currentNumber.split('.')[1].length >= 2)) {
        $('quickCalculatorNotice').textContent = 'Cada número admite hasta 15 dígitos y 2 decimales.';
        return;
      }
      if (currentNumber === '0') quickCalculationExpression = quickCalculationExpression.slice(0, -1);
      quickCalculationExpression += key;
    }
  } else return;
  if (quickCalculationExpression.length > QUICK_CALCULATION_MAX_LENGTH) {
    quickCalculationExpression = previousExpression;
    $('quickCalculatorNotice').textContent = 'La cuenta llegó al límite. Borra un dígito o limpia la cuenta.';
    return;
  }
  refreshMoneyKeypad();
}

function sendQuickCalculation() {
  const result = evaluateQuickCalculation(quickCalculationExpression);
  if (!isConverterKeypadTarget() || result.cents === null) { refreshMoneyKeypad(); return; }
  const inputId = moneyKeypadTarget;
  const currency = inputId === 'usdAmount' ? 'USD' : 'VES';
  if (!applyCalculatorResult(currency, result.cents)) return;
  closeQuickCalculation();
  $(inputId).focus({ preventScroll: true });
  $('keypadAnnouncement').textContent = `Resultado enviado a ${currency === 'USD' ? 'USD' : 'Bs'}: ${$(inputId).value}`;
}

function refreshMoneyKeypad() {
  const open = !$('moneyKeypad').hidden;
  document.querySelector('.page').dataset.keypadOpen = String(open);
  Object.keys(moneyKeypadFields).forEach(id => {
    const selected = open && moneyKeypadTarget === id;
    $(id).setAttribute('aria-expanded', String(selected));
    $(id).closest('.price-entry')?.classList.toggle('is-selected', selected);
  });
  $('keypadHeading').textContent = open && moneyKeypadTarget
    ? moneyKeypadFields[moneyKeypadTarget].label() : 'Teclado numérico';
  refreshQuickCalculation();
}

function openMoneyKeypad(inputId, focusInput = true) {
  const field = moneyKeypadFields[inputId];
  if (!field || $(inputId).closest('[role="tabpanel"]').hidden || !field.select()) return false;
  moneyKeypadTarget = inputId;
  $('moneyKeypad').hidden = false;
  refreshMoneyKeypad();
  if (focusInput && document.activeElement !== $(inputId)) $(inputId).focus({ preventScroll: true });
  return true;
}

function closeMoneyKeypad() {
  quickCalculationOpen = false;
  quickCalculationExpression = '';
  $('moneyKeypad').hidden = true;
  if (document.activeElement === $(moneyKeypadTarget) || $('moneyKeypad').contains(document.activeElement)) {
    document.activeElement.blur();
  }
  moneyKeypadTarget = null;
  refreshMoneyKeypad();
}

function writeMoneyKey(key) {
  if (!moneyKeypadTarget || $('moneyKeypad').hidden) return;
  if (key === 'cancel-calculation') {
    closeQuickCalculation();
    $('keypadAnnouncement').textContent = 'Cuenta cancelada. El monto no cambió.';
    return;
  }
  if (key === 'calculate') {
    if (!isConverterKeypadTarget()) return;
    if (quickCalculationOpen) closeQuickCalculation();
    else { quickCalculationOpen = true; quickCalculationExpression = ''; refreshMoneyKeypad(); }
    return;
  }
  if (key === 'done') {
    if (quickCalculationOpen) sendQuickCalculation();
    else closeMoneyKeypad();
    return;
  }
  if (quickCalculationOpen) { writeQuickCalculation(key); return; }
  if (key === 'reset') {
    const inputId = moneyKeypadTarget;
    const resetId = ['usdAmount', 'vesAmount'].includes(inputId) ? 'resetButton' : 'resetComparison';
    $(resetId).click();
    openMoneyKeypad(inputId);
    $('keypadAnnouncement').textContent = `Montos reiniciados. ${moneyKeypadFields[inputId].label()}: ${$(inputId).value || '0,00'}`;
    return;
  }
  const field = moneyKeypadFields[moneyKeypadTarget];
  if (!field.select()) return;
  field.write(key);
  refreshMoneyKeypad();
  $('keypadAnnouncement').textContent = `${field.label()}: ${$(moneyKeypadTarget).value || '0,00'}`;
}

Object.keys(moneyKeypadFields).forEach(inputId => {
  const input = $(inputId);
  input.readOnly = true;
  input.inputMode = 'none';
  input.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    // Set focus ourselves so tapping does not scroll the page or invoke a native editor.
    event.preventDefault();
    openMoneyKeypad(inputId);
  });
  input.addEventListener('focus', () => {
    if (document.activeElement === input) openMoneyKeypad(inputId, false);
  });
  input.addEventListener('click', () => openMoneyKeypad(inputId));
  input.addEventListener('contextmenu', event => event.preventDefault());
});

$('moneyKeypad').addEventListener('pointerdown', event => {
  if (event.target.closest('[data-money-key]')) event.preventDefault();
});
$('moneyKeypad').addEventListener('click', event => {
  const button = event.target.closest('[data-money-key]');
  if (button) writeMoneyKey(button.dataset.moneyKey);
});
$('quickCalculatorExpression').addEventListener('pointerdown', event => event.preventDefault());
$('quickCalculatorExpression').addEventListener('contextmenu', event => event.preventDefault());
$('resetButton').addEventListener('click', () => {
  if (quickCalculationOpen) { quickCalculationExpression = ''; refreshMoneyKeypad(); }
});

// A physical keyboard remains usable on a PC, with the same cents-first entry.
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.key === 'Escape' && !$('moneyKeypad').hidden) {
    event.preventDefault();
    if (quickCalculationOpen) closeQuickCalculation();
    else closeMoneyKeypad();
    return;
  }
  const focusedId = document.activeElement?.id;
  const editingInput = Object.prototype.hasOwnProperty.call(moneyKeypadFields, focusedId);
  const editingExpression = focusedId === 'quickCalculatorExpression' && quickCalculationOpen;
  const editingKeypad = $('moneyKeypad').contains(document.activeElement);
  if (!editingInput && !editingKeypad) return;
  const key = /^\d$/.test(event.key) ? event.key
    : ['Backspace', 'Delete'].includes(event.key) ? 'delete'
    : quickCalculationOpen && /^[+\-*/]$/.test(event.key) ? event.key
    : quickCalculationOpen && [',', '.'].includes(event.key) ? 'decimal'
    : (event.key === 'Enter' || (quickCalculationOpen && event.key === '=')) && (editingInput || editingExpression) ? 'done' : null;
  if (!key) return;
  event.preventDefault();
  if (editingInput && !openMoneyKeypad(focusedId, false)) return;
  writeMoneyKey(key);
});
refreshMoneyKeypad();
