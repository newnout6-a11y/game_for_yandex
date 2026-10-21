import {CONFIG} from './config.js';
import {clamp,formatNumber} from './util.js';
/** Pure presentation of the existing shared reserve and one distance milestone.
 * The road remains endless: reaching the flag neither ends nor restarts a run.
 * @param {Object} state Current simulation snapshot; never modified.
 * @returns {Object} Bounded levels and accessible descriptions.
 */
export function hudGaugePresentation(state) {
  const reserve=clamp(Number.isFinite(state.nitro)?state.nitro:0,0,100);
  const distance=Math.max(0,Number.isFinite(state.distance)?state.distance:0);
  const reached=distance>=CONFIG.goal;
  return {
    reserveLevel:reserve/100,
    reserveText:(state.flightAllowed===false?'Запас нитро: ':'Общий запас нитро и полёта: ')+Math.round(reserve)+'%.',
    progress:clamp(distance/CONFIG.goal,0,1),
    value:Math.min(CONFIG.goal,Math.floor(distance)),
    complete:reached,
    goalText:reached?'Цель '+formatNumber(CONFIG.goal)+' м выполнена. Заезд продолжается.':formatNumber(distance)+' из '+formatNumber(CONFIG.goal)+' м до цели дистанции.',
  };
}
