function addMessage(text, type) {
    const chat = document.getElementById("chat");

    const msg = document.createElement("div");
    msg.classList.add("message", type);
    msg.innerText = text;

    chat.appendChild(msg);
    chat.scrollTop = chat.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById("message");
    const text = input.value.trim();

    if (!text) return;

    addMessage(text, "user");
    input.value = "";

    // typing indicator
    addMessage("Typing...", "bot");

    fetch("/chat", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ message: text })
    })
    .then(res => res.json())
    .then(data => {
        const chat = document.getElementById("chat");
        chat.lastChild.remove(); // remove "Typing..."
        addMessage(data.reply, "bot");
    });
}

// Enter key support
document.getElementById("message").addEventListener("keypress", function(e) {
    if (e.key === "Enter") {
        sendMessage();
    }
});