document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get("analysis", (data) => {
    const simplifiedEl = document.getElementById("simplified");
    const questionsEl = document.getElementById("questions");
    const keywordsEl = document.getElementById("keywords");

    if (!data.analysis) {
      simplifiedEl.innerText = "Select text on a webpage to analyze.";
      return;
    }

    // Simplified
    simplifiedEl.innerText = data.analysis.simplified;

    // Questions (as list)
    questionsEl.innerHTML = "";
    data.analysis.questions.forEach(q => {
      const li = document.createElement("li");
      li.innerText = q;
      questionsEl.appendChild(li);
    });

    // Keywords (as tags)
    keywordsEl.innerHTML = "";
    data.analysis.keywords.forEach(k => {
      const span = document.createElement("span");
      span.className = "tag";
      span.innerText = k;
      keywordsEl.appendChild(span);
    });
  });
});