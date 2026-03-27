"""Centralized LLM prompts for all pipeline phases."""
from __future__ import annotations

# ---------------------------------------------------------------------------
# Shared suffixes — appended to extraction / verification prompts
# ---------------------------------------------------------------------------

REFUSAL_SUFFIX = (
    "\n\nIf any character is unclear, output [UNREADABLE] rather than guessing."
)

GROUNDED_COT_SUFFIX = (
    "\n\nCite the approximate location on the page for each finding "
    "(e.g. top-left, middle, bottom-right)."
)

# ---------------------------------------------------------------------------
# Handwriting
# ---------------------------------------------------------------------------

HANDWRITING_DETECT = (
    "Examine each page image. Identify pages that contain handwritten text "
    "(including annotations, signatures, margin notes, or form fill-ins). "
    "Return a JSON array of zero-indexed page numbers that contain handwriting. "
    "Example: [0, 3, 7]. Return [] if no handwriting is found."
)

HANDWRITING_EXTRACT = (
    "Extract ALL text from this page, both printed and handwritten. "
    "Prefix each handwritten segment with [Handwritten]. "
    "Preserve the spatial reading order (top-to-bottom, left-to-right). "
    "Use [UNREADABLE] for any character you cannot confidently identify."
    + REFUSAL_SUFFIX
)

# ---------------------------------------------------------------------------
# Image classification & extraction
# ---------------------------------------------------------------------------

IMAGE_CLASSIFY = (
    "Classify this image into exactly one category: "
    "DIAGRAM, CHART, EQUATION, TABLE, PHOTO, or OTHER. "
    "Return JSON: {\"category\": \"<CATEGORY>\", \"confidence\": <0.0-1.0>}."
)

DIAGRAM_EXTRACT = (
    "Extract the diagram as structured JSON with these fields:\n"
    "- diagram_type: flowchart | sequence | class | state | er | mindmap | other\n"
    "- nodes: [{id, label}]\n"
    "- edges: [{from, to, label?}]\n"
    "- mermaid: valid Mermaid code that reproduces this diagram\n\n"
    "Return only the JSON object."
    + REFUSAL_SUFFIX
)

DIAGRAM_VERIFY = (
    "Compare the original diagram image (first) with the rendered Mermaid image (second). "
    "List every difference: missing nodes, wrong edges, incorrect labels, layout issues. "
    "Return JSON: {\"matches\": true/false, \"differences\": [\"...\"]}"
    + REFUSAL_SUFFIX
)

CHART_EXTRACT = (
    "Extract this chart into structured data:\n"
    "- chart_type: bar | line | pie | scatter | area | other\n"
    "- title: chart title if visible\n"
    "- x_axis: axis label\n"
    "- y_axis: axis label\n"
    "- data: markdown table with all data points\n\n"
    "Be precise with numeric values. "
    "Return the result as a markdown table."
    + REFUSAL_SUFFIX
)

TABLE_FROM_IMAGE = (
    "Convert this table image to a precise markdown table. "
    "Preserve all rows, columns, merged cells, and headers. "
    "Mark any unclear cell content with [?]. "
    "Do not invent or guess values."
    + REFUSAL_SUFFIX
)

EQUATION_EXTRACT = (
    "Convert this mathematical expression to LaTeX. "
    "Wrap the result in $$ delimiters. "
    "Use standard LaTeX notation (\\frac, \\int, \\sum, etc.)."
    + REFUSAL_SUFFIX
)

PHOTO_DESCRIBE = (
    "Describe this photograph in 2-3 sentences. "
    "Focus on the content, context, and any visible text or labels."
)

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

ANCHORED_VERIFY = (
    "Compare the extracted text below against the page screenshot. "
    "Return JSON with:\n"
    "- confidence: 0.0-1.0 overall accuracy score\n"
    "- corrections: [{original, corrected, location}] for any errors\n"
    "- missing: [\"...\"] text visible in image but absent from extraction\n"
    "- unreadable_regions: [{location, description}] for genuinely unclear areas\n\n"
    "Pay special attention to character-confusion pairs: "
    "0/O, 1/l/I, 5/S, 6/G, 8/B, rn/m. "
    "Flag any suspected confusions in corrections with \"char_confusion\": true."
    + REFUSAL_SUFFIX
    + GROUNDED_COT_SUFFIX
)

ESCALATION_VERIFY = (
    "You are an escalation verifier. The primary model flagged issues with this extraction. "
    "Compare the extracted text against the page screenshot carefully. "
    "Return JSON with:\n"
    "- confidence: 0.0-1.0 overall accuracy score\n"
    "- corrections: [{original, corrected, location}] for any errors\n"
    "- missing: [\"...\"] text visible in image but absent from extraction\n"
    "- unreadable_regions: [{location, description}] for genuinely unclear areas\n\n"
    "Watch for character-confusion pairs: 0/O, 1/l/I, 5/S, 6/G, 8/B, rn/m."
    + REFUSAL_SUFFIX
    + GROUNDED_COT_SUFFIX
)

TIEBREAKER = (
    "System A says: {system_a}\n"
    "System B says: {system_b}\n\n"
    "Look at the image and determine which system is correct. "
    "Return JSON: {\"winner\": \"A\" or \"B\", \"reason\": \"...\"}"
    + REFUSAL_SUFFIX
)

# ---------------------------------------------------------------------------
# Geometric Risk Controller
# ---------------------------------------------------------------------------

GRC_READ = "Read the exact text in this image region. Return only the text."
