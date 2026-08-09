"use strict";

const DEFAULT_LAW = {
  usnIncome: 0.06, usnProfit: 0.15, usnMin: 0.01,
  ausnIncome: 0.08, ausnProfit: 0.20, ausnMin: 0.03,
  corporateProfit: 0.25, vatReduced1: 0.05, vatReduced2: 0.07,
  vatThreshold: 272500000, vatStandard: 0.22,
  ipFixed: 57390, ipExtraThreshold: 300000, ipExtraRate: 0.01,
  ipExtraMax: 321818, ipTotalMax: 379208, usnDeductionLimit: 0.50,
  ndfl: [
    { limit: 2400000, rate: 0.13, accumulated: 0 },
    { limit: 5000000, rate: 0.15, accumulated: 312000 },
    { limit: 20000000, rate: 0.18, accumulated: 702000 },
    { limit: 50000000, rate: 0.20, accumulated: 3402000 },
    { limit: Infinity, rate: 0.22, accumulated: 9402000 }
  ]
};

const settingGroups = [
  { title: "Налоговые ставки", fields: [["usnIncome","УСН «Доходы», %","percent"],["usnProfit","УСН «Д − Р», %","percent"],["usnMin","Минимум УСН Д − Р, %","percent"],["ausnIncome","АУСН «Доходы», %","percent"],["ausnProfit","АУСН «Д − Р», %","percent"],["ausnMin","Минимум АУСН Д − Р, %","percent"],["corporateProfit","Налог на прибыль ООО, %","percent"]] },
  { title: "НДС", fields: [["vatReduced1","Пониженная ставка 1, %","percent"],["vatReduced2","Пониженная ставка 2, %","percent"],["vatThreshold","Порог перехода, ₽","money"],["vatStandard","Стандартный НДС, %","percent"]] },
  { title: "Взносы ИП", fields: [["ipFixed","Фиксированная часть, ₽","money"],["ipExtraThreshold","Порог для 1%, ₽","money"],["ipExtraRate","Ставка превышения, %","percent"],["ipExtraMax","Максимум переменной части, ₽","money"],["ipTotalMax","Максимум всего, ₽","money"]] },
  { title: "Ограничения", fields: [["usnDeductionLimit","Макс. уменьшение УСН, %","percent"]] },
  { title: "НДФЛ ИП", ndfl: true }
];

let law = loadLaw();
let latestResults = [];
let selectedScenarioId = "";
const $ = id => document.getElementById(id);
const moneyFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function cloneDefaults() {
  return { ...DEFAULT_LAW, ndfl: DEFAULT_LAW.ndfl.map(x => ({ ...x })) };
}
function loadLaw() {
  try {
    const saved = JSON.parse(localStorage.getItem("tax-law-parameters"));
    if (!saved) return cloneDefaults();
    const loaded = { ...cloneDefaults(), ...saved, ndfl: saved.ndfl || cloneDefaults().ndfl };
    loaded.ndfl = loaded.ndfl.map((band, index) => ({
      ...band,
      limit: band.limit === null && index === loaded.ndfl.length - 1 ? Infinity : band.limit
    }));
    return loaded;
  } catch { return cloneDefaults(); }
}
function parseMoney(value) { return Math.max(0, Number(String(value).replace(/[^\d,.-]/g, "").replace(",", ".")) || 0); }
function formatMoney(value) { return `${moneyFmt.format(Math.round(value))} ₽`; }
function formatCompact(value) {
  const abs = Math.abs(value), sign = value < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}${pctFmt.format(abs/1e9)} млрд ₽`;
  if (abs >= 1e6) return `${sign}${pctFmt.format(abs/1e6)} млн ₽`;
  if (abs >= 1e3) return `${sign}${pctFmt.format(abs/1e3)} тыс. ₽`;
  return formatMoney(value);
}
function percent(value) { return `${pctFmt.format(value * 100)}%`; }
function inputData() {
  return {
    entity: document.querySelector('input[name="entity"]:checked').value,
    revenue: parseMoney($("revenue").value), variableCosts: parseMoney($("variableCosts").value),
    variableShare: Number($("variableVatShare").value) / 100,
    fixedCosts: parseMoney($("fixedCosts").value), fixedShare: Number($("fixedVatShare").value) / 100,
    employeeContributions: parseMoney($("employeeContributions").value)
  };
}
function ndfl(income) {
  if (income <= 0) return 0;
  let lower = 0;
  for (const band of law.ndfl) {
    if (income <= band.limit) return band.accumulated + (income - lower) * band.rate;
    lower = band.limit;
  }
  return 0;
}
function model(data) {
  const d = data;
  const varVatGross = d.variableCosts * d.variableShare, varNoVat = d.variableCosts - varVatGross;
  const fixedVatGross = d.fixedCosts * d.fixedShare, fixedNoVat = d.fixedCosts - fixedVatGross;
  const base = { revenueNet: d.revenue, varVat: varVatGross, varNoVat, fixedVat: fixedVatGross, fixedNoVat,
    opProfit: d.revenue - d.variableCosts - d.fixedCosts, outputVat: 0, inputVat: 0, vatPayable: 0, vatLabel: "0%" };
  const lowNet = d.revenue <= law.vatThreshold
    ? d.revenue / (1 + law.vatReduced1)
    : law.vatThreshold / (1 + law.vatReduced1) + (d.revenue - law.vatThreshold) / (1 + law.vatReduced2);
  const low = { revenueNet: lowNet, varVat: varVatGross, varNoVat, fixedVat: fixedVatGross, fixedNoVat,
    opProfit: lowNet - d.variableCosts - d.fixedCosts, outputVat: d.revenue - lowNet, inputVat: 0,
    vatPayable: d.revenue - lowNet, vatLabel: d.revenue <= law.vatThreshold ? percent(law.vatReduced1) : `${percent(law.vatReduced1)} / ${percent(law.vatReduced2)}` };
  const stdNet = d.revenue / (1 + law.vatStandard), stdVarVat = varVatGross / (1 + law.vatStandard), stdFixedVat = fixedVatGross / (1 + law.vatStandard);
  const stdInputVat = varVatGross - stdVarVat + fixedVatGross - stdFixedVat;
  const standard = { revenueNet: stdNet, varVat: stdVarVat, varNoVat, fixedVat: stdFixedVat, fixedNoVat,
    opProfit: stdNet - stdVarVat - varNoVat - stdFixedVat - fixedNoVat,
    outputVat: d.revenue - stdNet, inputVat: stdInputVat, vatPayable: d.revenue - stdNet - stdInputVat, vatLabel: percent(law.vatStandard) };
  const ipExtra = Math.min(Math.max((d.revenue - law.ipExtraThreshold) * law.ipExtraRate, 0), law.ipExtraMax);
  const ipContributions = d.entity === "ip" ? Math.min(law.ipFixed + ipExtra, law.ipTotalMax) : 0;
  const results = [];
  const add = (id, regime, block, tax, explanation) => results.push({ id, regime, ...block, tax: Math.max(tax, 0), netProfit: block.opProfit - Math.max(tax,0), explanation });
  const usnIncome = (id, block) => {
    const assessed = block.revenueNet * law.usnIncome;
    const contributionPool = d.employeeContributions + ipContributions;
    const deduction = Math.min(contributionPool, assessed * law.usnDeductionLimit);
    add(id, "УСН «Доходы»", block, assessed - deduction, `Налоговая база ${formatMoney(block.revenueNet)} × ${percent(law.usnIncome)}. Вычет взносов — ${formatMoney(deduction)} (не более ${percent(law.usnDeductionLimit)} налога).`);
  };
  const usnProfit = (id, block) => {
    const regular = block.opProfit * law.usnProfit, minimum = block.revenueNet * law.usnMin;
    add(id, "УСН «Доходы − расходы»", block, Math.max(0, regular, minimum), `${regular >= minimum && regular > 0 ? "Применён обычный" : "Применён минимальный"} налог: максимум из ${percent(law.usnProfit)} операционной прибыли и ${percent(law.usnMin)} налоговой базы.`);
  };
  usnIncome("usn-income-0", base); usnIncome("usn-income-low", low); usnIncome("usn-income-std", standard);
  usnProfit("usn-profit-0", base); usnProfit("usn-profit-low", low); usnProfit("usn-profit-std", standard);
  [base, standard].forEach((block, i) => {
    const tax = d.entity === "ooo" ? Math.max(block.opProfit * law.corporateProfit, 0) : ndfl(block.opProfit);
    add(`osno-${i}`, "ОСНО", block, tax, d.entity === "ooo" ? `Налог на прибыль: ${percent(law.corporateProfit)} положительной операционной прибыли.` : "НДФЛ рассчитан по прогрессивной шкале из настроек законодательства.");
  });
  add("ausn-income", "АУСН «Доходы»", base, d.revenue > 0 ? d.revenue * law.ausnIncome : 0, `Налог: ${percent(law.ausnIncome)} выручки.`);
  add("ausn-profit", "АУСН «Доходы − расходы»", base, Math.max(Math.max(0, base.opProfit) * law.ausnProfit, d.revenue * law.ausnMin), `Максимум из ${percent(law.ausnProfit)} положительной операционной прибыли и ${percent(law.ausnMin)} выручки.`);
  return results.sort((a,b) => b.netProfit - a.netProfit);
}

function recalculate() {
  const data = inputData(); latestResults = model(data);
  if (!selectedScenarioId || !latestResults.some(r => r.id === selectedScenarioId)) selectedScenarioId = latestResults[0].id;
  $("variableVatShareOutput").textContent = `${Math.round(data.variableShare*100)}%`;
  $("fixedVatShareOutput").textContent = `${Math.round(data.fixedShare*100)}%`;
  $("costRatio").textContent = data.revenue ? percent((data.variableCosts + data.fixedCosts) / data.revenue) : "—";
  renderWinner(data); renderChart(); renderTable(data); renderScenarioSelect(); renderDetails(data);
}
function renderWinner(data) {
  const best = latestResults[0], second = latestResults[1], delta = best.netProfit - second.netProfit;
  $("winnerName").textContent = `${best.regime} · НДС ${best.vatLabel}`;
  $("winnerLead").textContent = delta > 0 ? `На ${formatCompact(delta)} больше ближайшей альтернативы` : "Такой же результат у ближайшей альтернативы";
  $("winnerProfit").textContent = formatCompact(best.netProfit);
  $("winnerProfit").classList.toggle("negative-value", best.netProfit < 0);
  $("winnerMargin").textContent = data.revenue ? percent(best.netProfit / data.revenue) : "—";
  $("winnerBurden").textContent = formatCompact(best.tax + best.vatPayable);
}
function renderChart() {
  const shown = latestResults.slice(0, 6), max = Math.max(...shown.map(r => Math.abs(r.netProfit)), 1);
  $("profitChart").innerHTML = shown.map((r,i) => `<div class="bar-row ${i===0?"best":""} ${r.netProfit<0?"negative":""}" title="${r.regime}, НДС ${r.vatLabel}"><span class="bar-label">${r.regime} · ${r.vatLabel}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(Math.abs(r.netProfit)/max*100,1)}%"></div></div><span class="bar-value ${r.netProfit<0?"negative-value":""}">${formatCompact(r.netProfit)}</span></div>`).join("");
}
function renderTable(data) {
  $("comparisonBody").innerHTML = latestResults.map((r,i) => `<tr class="${i===0?"best-row":""}"><td>${r.regime}${i===0?'<span class="rank-badge">ЛУЧШИЙ</span>':''}</td><td>${r.vatLabel}</td><td class="num ${r.netProfit<0?"negative-value":""}">${formatMoney(r.netProfit)}</td><td class="num">${formatMoney(r.tax)}</td><td class="num">${r.vatLabel==='0%'?'—':formatMoney(r.vatPayable)}</td><td class="num">${data.revenue?percent(r.netProfit/data.revenue):'—'}</td><td><button class="detail-button" data-detail="${r.id}">Подробнее</button></td></tr>`).join("");
  document.querySelectorAll("[data-detail]").forEach(btn => btn.addEventListener("click", () => { selectedScenarioId = btn.dataset.detail; renderScenarioSelect(); renderDetails(inputData()); $("detailsSection").scrollIntoView({behavior:"smooth"}); }));
}
function renderScenarioSelect() {
  $("scenarioSelect").innerHTML = latestResults.map(r => `<option value="${r.id}" ${r.id===selectedScenarioId?"selected":""}>${r.regime} · НДС ${r.vatLabel}</option>`).join("");
}
function renderDetails(data) {
  const r = latestResults.find(x => x.id === selectedScenarioId) || latestResults[0];
  $("detailsTitle").textContent = `${r.regime} · НДС ${r.vatLabel}`;
  const rows = [
    ["Выручка без НДС",r.revenueNet],["Переменные расходы с НДС",-r.varVat],["Переменные расходы без НДС",-r.varNoVat],
    ["Валовая прибыль",r.revenueNet-r.varVat-r.varNoVat],["Постоянные расходы с НДС",-r.fixedVat],["Постоянные расходы без НДС",-r.fixedNoVat],
    ["Операционная прибыль",r.opProfit],["Налог",-r.tax],["Чистая прибыль",r.netProfit]
  ];
  $("pnlBody").innerHTML = rows.map(([name,val],i) => `<tr class="${i===8?'total':''}"><td>${name}</td><td class="${val<0?'negative-value':''}">${formatMoney(val)}</td><td>${data.revenue?percent(val/data.revenue):'—'}</td></tr>`).join("");
  const wf = [["Выручка",r.revenueNet,"income"],["Переменные",r.varVat+r.varNoVat,"deduction"],["Постоянные",r.fixedVat+r.fixedNoVat,"deduction"],["Налог",r.tax,"deduction"],["Чистая прибыль",r.netProfit,"total"]];
  const max = Math.max(r.revenueNet,...wf.map(x=>Math.abs(x[1])),1);
  $("waterfall").innerHTML = wf.map(([name,val,type]) => `<div class="water-row ${type}"><span>${name}</span><div class="water-track"><div class="water-fill" style="width:${Math.max(Math.abs(val)/max*100,2)}%">${formatCompact(val)}</div></div></div>`).join("");
  const vatText = r.vatLabel === "0%" ? "Сценарий без НДС." : `Исходящий НДС ${formatMoney(r.outputVat)}, входящий НДС к вычету ${formatMoney(r.inputVat)}, к уплате ${formatMoney(r.vatPayable)}.`;
  $("calculationExplanation").innerHTML = `<strong>Как рассчитано.</strong> ${r.explanation} ${vatText}`;
}

function buildSettings() {
  $("settingsFields").innerHTML = settingGroups.map((group, gi) => {
    const fields = group.ndfl ? law.ndfl.map((b,i) => [`ndfl-${i}`, `${i+1}-я ступень: ставка / предел`, "ndfl", b]) : group.fields;
    return `<section class="settings-group"><h3>${group.title}</h3>${fields.map(([key,label,type,band]) => type === "ndfl"
      ? `<div class="setting-row"><label for="${key}-rate">${label}</label><span><input id="${key}-rate" data-ndfl-rate="${key.split('-')[1]}" type="number" step="0.1" value="${band.rate*100}" title="Ставка, %"><input data-ndfl-limit="${key.split('-')[1]}" type="number" value="${Number.isFinite(band.limit)?band.limit:''}" placeholder="Без лимита" title="Предел, ₽"></span></div>`
      : `<div class="setting-row"><label for="setting-${key}">${label}</label><input id="setting-${key}" data-setting="${key}" data-type="${type}" type="number" min="0" step="${type==='percent'?'0.1':'1'}" value="${type==='percent'?law[key]*100:law[key]}"></div>`).join("")}</section>`;
  }).join("");
}
function saveSettings() {
  document.querySelectorAll("[data-setting]").forEach(el => { law[el.dataset.setting] = Math.max(0, Number(el.value)||0) / (el.dataset.type === "percent" ? 100 : 1); });
  document.querySelectorAll("[data-ndfl-rate]").forEach(el => { law.ndfl[Number(el.dataset.ndflRate)].rate = Math.max(0, Number(el.value)||0)/100; });
  document.querySelectorAll("[data-ndfl-limit]").forEach(el => { law.ndfl[Number(el.dataset.ndflLimit)].limit = el.value ? Number(el.value) : Infinity; });
  let lower = 0, accumulated = 0;
  law.ndfl.forEach(b => { b.accumulated = accumulated; if(Number.isFinite(b.limit)){ accumulated += (b.limit-lower)*b.rate; lower=b.limit; } });
  localStorage.setItem("tax-law-parameters", JSON.stringify(law)); recalculate(); showToast("Настройки сохранены, расчёт обновлён");
}
function exportCsv() {
  const rows = [["Режим","НДС","Чистая прибыль","Налог","НДС к уплате","Рентабельность"], ...latestResults.map(r => [r.regime,r.vatLabel,Math.round(r.netProfit),Math.round(r.tax),Math.round(r.vatPayable),inputData().revenue ? (r.netProfit/inputData().revenue*100).toFixed(1)+"%":"—"])];
  const csv = "\ufeff" + rows.map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(";")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})); a.download = "sravnenie-nalogovyh-rezhimov.csv"; a.click(); URL.revokeObjectURL(a.href);
}
function showToast(text) { const t=$("toast"); t.textContent=text; t.classList.add("show"); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>t.classList.remove("show"),2600); }
function formatInput(el) { const value=parseMoney(el.value); el.value=value?moneyFmt.format(value):""; }

document.querySelectorAll('.money-input input').forEach(el => { el.addEventListener("focus",()=>el.value=parseMoney(el.value)||""); el.addEventListener("blur",()=>{formatInput(el);recalculate()}); el.addEventListener("input",recalculate); });
document.querySelectorAll('input[name="entity"], input[type="range"]').forEach(el=>el.addEventListener("input",recalculate));
$("scenarioSelect").addEventListener("change",e=>{selectedScenarioId=e.target.value;renderDetails(inputData())});
$("settingsButton").addEventListener("click",()=>{buildSettings();$("settingsDialog").showModal()});
$("saveSettings").addEventListener("click",saveSettings);
$("resetSettings").addEventListener("click",()=>{law=cloneDefaults();localStorage.removeItem("tax-law-parameters");buildSettings();recalculate();showToast("Значения по умолчанию восстановлены")});
$("exportButton").addEventListener("click",exportCsv);
$("exampleButton").addEventListener("click",()=>{ $("revenue").value="30 000 000";$("variableCosts").value="12 000 000";$("fixedCosts").value="6 000 000";$("employeeContributions").value="900 000";$("variableVatShare").value=60;$("fixedVatShare").value=40;recalculate();showToast("Пример загружен") });
document.querySelectorAll(".hint").forEach(el=>el.addEventListener("click",e=>e.preventDefault()));
recalculate();
