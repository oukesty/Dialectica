import { jsPDF } from "jspdf";
import { AppLocale, DiscussionProject } from "@/lib/types";

const MARGIN = 20;
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 6;
const FONT_SIZE_TITLE = 18;
const FONT_SIZE_HEADING = 12;
const FONT_SIZE_BODY = 9;
const FONT_SIZE_SMALL = 7;

function addNewPageIfNeeded(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > 280) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function wrapText(doc: jsPDF, text: string, maxWidth: number): string[] {
  return doc.splitTextToSize(text, maxWidth) as string[];
}

export function exportProjectToPdf(project: DiscussionProject, locale: AppLocale) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = MARGIN;

  // Title
  doc.setFontSize(FONT_SIZE_TITLE);
  doc.setFont("helvetica", "bold");
  const titleLines = wrapText(doc, project.title, CONTENT_WIDTH);
  for (const line of titleLines) {
    y = addNewPageIfNeeded(doc, y, LINE_HEIGHT * 2);
    doc.text(line, MARGIN, y);
    y += LINE_HEIGHT * 1.8;
  }

  // Description
  doc.setFontSize(FONT_SIZE_BODY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  const descLines = wrapText(doc, project.description || "", CONTENT_WIDTH);
  for (const line of descLines) {
    y = addNewPageIfNeeded(doc, y, LINE_HEIGHT);
    doc.text(line, MARGIN, y);
    y += LINE_HEIGHT;
  }
  doc.setTextColor(0);
  y += LINE_HEIGHT;

  // Metadata
  doc.setFontSize(FONT_SIZE_SMALL);
  doc.setTextColor(120);
  const meta = [
    `Scenario: ${project.scenario}`,
    `Language: ${project.language}`,
    `Status: ${project.status}`,
    `Created: ${new Date(project.createdAt).toLocaleDateString(locale)}`,
    `Updated: ${new Date(project.updatedAt).toLocaleDateString(locale)}`,
    `Participants: ${project.participants.length}`,
    `Entries: ${project.entries.length}`,
  ].join("  |  ");
  y = addNewPageIfNeeded(doc, y, LINE_HEIGHT);
  doc.text(meta, MARGIN, y);
  doc.setTextColor(0);
  y += LINE_HEIGHT * 2;

  // Participants section
  doc.setFontSize(FONT_SIZE_HEADING);
  doc.setFont("helvetica", "bold");
  y = addNewPageIfNeeded(doc, y, LINE_HEIGHT * 2);
  doc.text("Participants", MARGIN, y);
  y += LINE_HEIGHT * 1.5;

  doc.setFontSize(FONT_SIZE_BODY);
  doc.setFont("helvetica", "normal");
  for (const participant of project.participants) {
    y = addNewPageIfNeeded(doc, y, LINE_HEIGHT * 2);
    doc.setFont("helvetica", "bold");
    doc.text(`${participant.name} (${participant.role})`, MARGIN, y);
    doc.setFont("helvetica", "normal");
    y += LINE_HEIGHT;
    if (participant.stance) {
      doc.setTextColor(80);
      const stanceLines = wrapText(doc, `Stance: ${participant.stance}`, CONTENT_WIDTH - 5);
      for (const line of stanceLines) {
        y = addNewPageIfNeeded(doc, y, LINE_HEIGHT);
        doc.text(line, MARGIN + 5, y);
        y += LINE_HEIGHT;
      }
      doc.setTextColor(0);
    }
  }
  y += LINE_HEIGHT;

  // Discussion timeline
  doc.setFontSize(FONT_SIZE_HEADING);
  doc.setFont("helvetica", "bold");
  y = addNewPageIfNeeded(doc, y, LINE_HEIGHT * 2);
  doc.text("Discussion Timeline", MARGIN, y);
  y += LINE_HEIGHT * 1.5;

  doc.setFontSize(FONT_SIZE_BODY);
  for (const entry of project.entries) {
    const participant = project.participants.find((p) => p.id === entry.participantId);
    const speaker = participant?.name ?? "Unknown";
    const time = new Date(entry.occurredAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

    y = addNewPageIfNeeded(doc, y, LINE_HEIGHT * 3);

    // Speaker + time
    doc.setFont("helvetica", "bold");
    doc.text(`[${time}] ${speaker}`, MARGIN, y);
    doc.setFont("helvetica", "normal");
    y += LINE_HEIGHT;

    // Content
    const contentLines = wrapText(doc, entry.content, CONTENT_WIDTH - 5);
    for (const line of contentLines) {
      y = addNewPageIfNeeded(doc, y, LINE_HEIGHT);
      doc.text(line, MARGIN + 5, y);
      y += LINE_HEIGHT;
    }

    // Tags
    if (entry.tags.length > 0) {
      doc.setTextColor(100);
      doc.setFontSize(FONT_SIZE_SMALL);
      y = addNewPageIfNeeded(doc, y, LINE_HEIGHT);
      doc.text(`Tags: ${entry.tags.join(", ")}`, MARGIN + 5, y);
      doc.setFontSize(FONT_SIZE_BODY);
      doc.setTextColor(0);
      y += LINE_HEIGHT;
    }
    y += LINE_HEIGHT * 0.5;
  }

  // Summary section
  if (project.summary.overview) {
    y += LINE_HEIGHT;
    doc.setFontSize(FONT_SIZE_HEADING);
    doc.setFont("helvetica", "bold");
    y = addNewPageIfNeeded(doc, y, LINE_HEIGHT * 2);
    doc.text("Summary", MARGIN, y);
    y += LINE_HEIGHT * 1.5;

    doc.setFontSize(FONT_SIZE_BODY);
    doc.setFont("helvetica", "normal");
    const summaryLines = wrapText(doc, project.summary.overview, CONTENT_WIDTH);
    for (const line of summaryLines) {
      y = addNewPageIfNeeded(doc, y, LINE_HEIGHT);
      doc.text(line, MARGIN, y);
      y += LINE_HEIGHT;
    }
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(FONT_SIZE_SMALL);
    doc.setTextColor(150);
    doc.text(`Dialectica - ${project.title} - Page ${i}/${pageCount}`, MARGIN, 290);
  }

  // Save
  const filename = `${project.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_").slice(0, 40)}_${Date.now()}.pdf`;
  doc.save(filename);
}
