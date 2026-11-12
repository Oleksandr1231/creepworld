const msgs = ["Я ж казав...", "Вони вже йдуть.", "Озирнись.", "Ще не пізно зупинитись."];
let i = 0;
document.getElementById("btn").addEventListener("click", () => {
  document.getElementById("msg").textContent = msgs[i++ % msgs.length];
});