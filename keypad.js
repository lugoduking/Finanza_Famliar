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
  $('moneyKeypad').hidden = true;
  if (document.activeElement === $(moneyKeypadTarget) || $('moneyKeypad').contains(document.activeElement)) {
    document.activeElement.blur();
  }
  moneyKeypadTarget = null;
  refreshMoneyKeypad();
}

function writeMoneyKey(key) {
  if (key === 'done') { closeMoneyKeypad(); return; }
  if (!moneyKeypadTarget || $('moneyKeypad').hidden) return;
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

// A physical keyboard remains usable on a PC, with the same cents-first entry.
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.key === 'Escape' && !$('moneyKeypad').hidden) {
    event.preventDefault();
    closeMoneyKeypad();
    return;
  }
  const focusedId = document.activeElement?.id;
  const editingInput = Object.prototype.hasOwnProperty.call(moneyKeypadFields, focusedId);
  const editingKeypad = $('moneyKeypad').contains(document.activeElement);
  if (!editingInput && !editingKeypad) return;
  const key = /^\d$/.test(event.key) ? event.key
    : ['Backspace', 'Delete'].includes(event.key) ? 'delete'
    : event.key === 'Enter' && editingInput ? 'done' : null;
  if (!key) return;
  event.preventDefault();
  if (editingInput && !openMoneyKeypad(focusedId, false)) return;
  writeMoneyKey(key);
});
refreshMoneyKeypad();
