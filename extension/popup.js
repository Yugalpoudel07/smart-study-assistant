document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get("analysis", (data) => {
    if (!data.analysis) {
      document.getElementById("simplified").innerText = "No data yet";
      return;
    }

    document.getElementById("simplified").innerText =
      data.analysis.simplified;

    document.getElementById("questions").innerText =
      data.analysis.questions.join("\n");

    document.getElementById("keywords").innerText =
      data.analysis.keywords.join(", ");
  });
});