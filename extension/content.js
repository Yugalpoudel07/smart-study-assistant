async function sendTextToBackend(text) {
  const response = await fetch("http://127.0.0.1:8000/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text: text })
  });

  return await response.json();
}

document.addEventListener("mouseup", async () => {
  let selectedText = window.getSelection().toString().trim();

  if (selectedText.length > 20) { // avoid small clicks
    const result = await sendTextToBackend(selectedText);

    chrome.storage.local.set({
      analysis: result,
      selectedText: selectedText
    });
  }
});