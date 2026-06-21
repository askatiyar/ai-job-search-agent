document.getElementById("generate").addEventListener("click", async () => {
  const status = document.getElementById("status");
  status.textContent = "Reading job page...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const jobData = await chrome.tabs.sendMessage(tab.id, {
    type: "EXTRACT_JOB"
  });

  status.textContent = "Creating drafts...";
console.log("Sending to backend:", jobData);
  const response = await fetch("http://localhost:8000/api/job-packet", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(jobData)
});

  const result = await response.json();

status.innerHTML = `
<b>Done!</b><br><br>
<a href="${result.matchAnalysisUrl}" target="_blank">Match Analysis</a><br>
<a href="${result.resumeUrl}" target="_blank">Resume</a><br>
<a href="${result.coverLetterUrl}" target="_blank">Cover Letter</a>
`;
});