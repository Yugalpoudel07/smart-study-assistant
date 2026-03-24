document.addEventListener("DOMContentLoaded", () => {
    chrome.storage.local.get("selectedText", async (data) => {
        const output = document.getElementById("output");

        if (data.selectedText) {
            output.innerText = "Loading...";

            try {
                const response = await fetch("http://127.0.0.1:8000/analyze", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ text: data.selectedText })
                });

                const result = await response.json();

                output.innerText = `
Simplified: ${result.simplified}

Questions: ${result.questions.join(", ")}

Keywords: ${result.keywords.join(", ")}
                `;
            } catch (error) {
                output.innerText = "Error connecting to backend.";
                console.error(error);
            }
        } else {
            output.innerText = "No text selected";
        }
    });
});

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get("analysis", (data) => {
    if (!data.analysis) return;

    document.getElementById("simplified").innerText =
      data.analysis.simplified;

    document.getElementById("questions").innerText =
      data.analysis.questions.join("\n");

    document.getElementById("keywords").innerText =
      data.analysis.keywords.join(", ");
  });
});