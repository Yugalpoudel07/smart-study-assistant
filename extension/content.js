async function sendTextToBackend(text) {
  const response = await fetch("http://127.0.0.1:8000/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text: text })
  });

  const data = await response.json();
  return data;
}

document.addEventListener("mouseup", async () => {
  let selectedText = window.getSelection().toString().trim();

  if (selectedText.length > 0) {
    const result = await sendTextToBackend(selectedText);

    console.log("Simplified:", result.simplified);
    console.log("Questions:", result.questions);
    console.log("Keywords:", result.keywords);

    chrome.storage.local.set({ analysis: result });
  }
});