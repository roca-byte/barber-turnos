const test = require('node:test');
const assert = require('node:assert');
const Agenda = require('../js/agenda.js');

const t = (hhmm) => `2026-12-01T${hhmm}:00.000Z`;
const r = (a, b) => ({ desde: t(a), hasta: t(b) });
const o = (a, b) => ({ inicio: t(a), fin: t(b) });

test('resta ocupados de la franja', () => {
  assert.deepStrictEqual(
    Agenda.huecos([r('09:00', '13:00')], [o('10:00', '10:30'), o('12:30', '13:00')]),
    [r('09:00', '10:00'), r('10:30', '12:30')]
  );
});

test('sin ocupados devuelve la franja entera', () => {
  assert.deepStrictEqual(Agenda.huecos([r('09:00', '13:00')], []), [r('09:00', '13:00')]);
});

test('un ocupado que excede la franja no rompe', () => {
  assert.deepStrictEqual(Agenda.huecos([r('09:00', '13:00')], [o('08:00', '09:30'), o('12:00', '15:00')]),
    [r('09:30', '12:00')]);
});

test('ocupado que cubre toda la franja la elimina', () => {
  assert.deepStrictEqual(Agenda.huecos([r('09:00', '13:00')], [o('08:00', '14:00')]), []);
});

test('ocupados superpuestos y desordenados', () => {
  assert.deepStrictEqual(
    Agenda.huecos([r('09:00', '13:00')], [o('11:00', '12:00'), o('09:30', '11:30')]),
    [r('09:00', '09:30'), r('12:00', '13:00')]
  );
});

test('descarta huecos de menos de un minuto', () => {
  assert.deepStrictEqual(
    Agenda.huecos([r('09:00', '10:00')], [{ inicio: t('09:00').replace(':00.000', ':30.000'), fin: t('10:00') }]),
    []
  );
});

test('varias franjas', () => {
  assert.deepStrictEqual(
    Agenda.huecos([r('09:00', '12:00'), r('15:00', '19:00')], [o('11:00', '16:00')]),
    [r('09:00', '11:00'), r('16:00', '19:00')]
  );
});
