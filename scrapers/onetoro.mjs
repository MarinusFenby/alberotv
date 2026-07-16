import fs from "node:fs/promises";

const API_URL =
  "https://galgo-onetoro.galgo.tv/container/ultimos-dos-festejos?page=1&size=300&version=2&language=es&image-format=webp";

function parseDateFromName(name = "") {
  const match = name.match(/\((\d{2})\/(\d{2})\/(\d{4})\)/);

  if (!match) return null;

  const [, day, month, year] = match;

  return `${year}-${month}-${day}`;
}

function cleanName(name = "") {
  return name.replace(/\s+/g, " ").trim();
}

function extractItems(data) {
  const possibleArrays = [
    data.contents,
    data.content,
    data.items,
    data.videos,
    data.children
  ];

  for (const array of possibleArrays) {
    if (Array.isArray(array)) {
      return array;
    }
  }

  for (const value of Object.values(data)) {
    if (
      Array.isArray(value) &&
      value.some(
        item =>
          item &&
          typeof item === "object" &&
          (item.name || item.analytics?.name)
      )
    ) {
      return value;
    }
  }

  return [];
}

async function main() {
  const response = await fetch(API_URL);

  if (!response.ok) {
    throw new Error(
      `Error OneToro API: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();

  const items = extractItems(data);

  const events = items
    .filter(item => item?.itemType === "Video")
    .map(item => {
      const name = cleanName(
        item.name ||
        item.analytics?.name ||
        ""
      );

      const labels =
        item.layout?.LABEL ||
        item.layout?.label?.map(label => label.value) ||
        [];

      return {
        id: item._id || null,
        name,
        date: parseDateFromName(name),
        channel: "OneToro",
        participants: labels,
        slug: item.slug || null,

        image:
          item.thumbnail?.landscape ||
          item.thumbnail?.landscapes?.[0]?.url ||
          null,

        sourceUrl:
          item.slug
            ? `https://festejos.onetoro.tv/content/${item.slug}`
            : null,

        published: item.published ?? null,
        live: item.live ?? null
      };
    })
    .filter(event => event.name && event.date);

  const result = {
    source: "OneToro",
    sourceUrl: API_URL,
    fetchedAt: new Date().toISOString(),
    eventCount: events.length,
    events
  };

  await fs.mkdir("data", {
    recursive: true
  });

  await fs.writeFile(
    "data/onetoro.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log(
    `OneToro: ${events.length} eventos guardados`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
