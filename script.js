const msgs = ["Я же говорил...", "Они уже идут.", "Оглянись.", "Ещё не поздно остановиться."];
let i = 0;
document.getElementById("btn").addEventListener("click", () => {
  document.getElementById("msg").textContent = msgs[i++ % msgs.length];
});