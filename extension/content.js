function cleanText(text) {
  return (text || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLines() {
  return document.body.innerText
    .split("\n")
    .map(cleanText)
    .filter(Boolean);
}

function extractCompany(lines) {
  const companyFromLink = cleanText(
    document.querySelector("a[href*='/company/']")?.innerText
  );

  if (
    companyFromLink &&
    companyFromLink.length < 80 &&
    !companyFromLink.toLowerCase().includes("notification")
  ) {
    return companyFromLink;
  }

  const aboutIndex = lines.findIndex(
    line => line.toLowerCase() === "about the job"
  );

  const topLines = aboutIndex > 0 ? lines.slice(0, aboutIndex) : lines.slice(0, 40);

  const companyCandidate = topLines.find(line =>
    line.length < 80 &&
    !line.toLowerCase().includes("notification") &&
    !line.toLowerCase().includes("apply") &&
    !line.toLowerCase().includes("saved") &&
    !line.toLowerCase().includes("remote") &&
    !line.toLowerCase().includes("full-time") &&
    !line.toLowerCase().includes("linkedin") &&
    !line.toLowerCase().includes("jobs")
  );

  return companyCandidate || "";
}

function extractTitle(lines, company) {
  const titleFromH1 = cleanText(
    document.querySelector("h1")?.innerText
  );

  if (titleFromH1) {
    return titleFromH1;
  }

  const titleFromMeta = cleanText(
    document.querySelector("meta[property='og:title']")?.content
  );

  if (titleFromMeta) {
    return titleFromMeta
      .replace("| LinkedIn", "")
      .replace(company, "")
      .replace(/\|/g, "")
      .trim();
  }

  const titleFromDocument = cleanText(document.title);

  if (titleFromDocument && titleFromDocument.includes("|")) {
    return titleFromDocument.split("|")[0].trim();
  }

  const companyIndex = lines.findIndex(line => line === company);

  if (companyIndex !== -1) {
    for (let i = companyIndex + 1; i < Math.min(companyIndex + 8, lines.length); i++) {
      const candidate = lines[i];

      if (
        candidate &&
        candidate.length < 120 &&
        !candidate.toLowerCase().includes("san francisco") &&
        !candidate.toLowerCase().includes("remote") &&
        !candidate.toLowerCase().includes("full-time") &&
        !candidate.toLowerCase().includes("apply") &&
        !candidate.toLowerCase().includes("saved") &&
        !candidate.toLowerCase().includes("reposted") &&
        !candidate.toLowerCase().includes("people clicked")
      ) {
        return candidate;
      }
    }
  }

  return "";
}

function extractDescription(lines) {
  const aboutIndex = lines.findIndex(
    line => line.toLowerCase() === "about the job"
  );

  if (aboutIndex !== -1) {
    const endMarkers = [
      "show more",
      "skills",
      "seniority level",
      "employment type",
      "job function",
      "industries",
      "similar jobs"
    ];

    let endIndex = lines.length;

    for (const marker of endMarkers) {
      const idx = lines.findIndex((line, i) =>
        i > aboutIndex && line.toLowerCase() === marker
      );

      if (idx !== -1 && idx < endIndex) {
        endIndex = idx;
      }
    }

    return lines.slice(aboutIndex + 1, endIndex).join("\n");
  }

  return cleanText(
    document.querySelector(".jobs-description-content__text")?.innerText ||
    document.querySelector(".jobs-description__content")?.innerText ||
    document.querySelector(".jobs-box__html-content")?.innerText ||
    ""
  );
}

function getJobData() {
  const lines = getLines();

  const company = extractCompany(lines);
  const title = extractTitle(lines, company);
  const description = extractDescription(lines);

  const jobData = {
    url: window.location.href,
    title,
    company,
    description
  };

  console.log("JOB DATA:", jobData);

  return jobData;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_JOB") {
    sendResponse(getJobData());
  }
});