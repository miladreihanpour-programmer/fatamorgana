from __future__ import annotations

import argparse
from html import escape
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A3, A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


DEFAULT_FONT_SIZE = 10
PAGE_MARGIN = 24
SUBHEADERS = {"ESAURITO", "MANTENIMENTO", "ORDINE"}
GROUP_COLORS = [
    colors.HexColor("#F3E6D6"),
    colors.HexColor("#E6F0E8"),
    colors.HexColor("#E7ECF7"),
    colors.HexColor("#F8E4E4"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a grouped Excel sheet into a readable landscape PDF.",
    )
    parser.add_argument(
        "excel_path",
        nargs="?",
        default="gelato_flavors.xlsx",
        help="Path to the input Excel file.",
    )
    parser.add_argument(
        "output_path",
        nargs="?",
        default=None,
        help="Optional PDF output path. Defaults to the Excel filename with .pdf extension.",
    )
    parser.add_argument(
        "--sheet",
        default=None,
        help="Optional sheet name. Defaults to the first sheet.",
    )
    return parser.parse_args()


def format_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def load_sheet_rows(excel_path: Path, sheet_name: str | None = None) -> tuple[str, list[list[str]]]:
    workbook = load_workbook(excel_path, data_only=True, read_only=True)
    active_sheet_name = sheet_name or workbook.sheetnames[0]

    dataframe = pd.read_excel(
        excel_path,
        sheet_name=active_sheet_name,
        header=None,
        engine="openpyxl",
        keep_default_na=False,
    )

    rows = [
        [format_value(cell) for cell in row]
        for row in dataframe.itertuples(index=False, name=None)
    ]
    return active_sheet_name, rows


def detect_group_ranges(header_row: list[str]) -> list[tuple[int, int, str]]:
    starts: list[tuple[int, str]] = []
    for index, value in enumerate(header_row):
        label = format_value(value)
        if label and label.upper() not in SUBHEADERS:
            starts.append((index, label))

    if not starts:
        return [(0, len(header_row) - 1, "Table")]

    ranges: list[tuple[int, int, str]] = []
    for i, (start_idx, label) in enumerate(starts):
        end_idx = starts[i + 1][0] - 1 if i + 1 < len(starts) else len(header_row) - 1
        ranges.append((start_idx, end_idx, label))
    return ranges


def choose_page_size(required_width: float) -> tuple[tuple[float, float], float]:
    candidates = [landscape(A4), landscape(A3)]
    for page_size in candidates:
        available_width = page_size[0] - (PAGE_MARGIN * 2)
        if required_width <= available_width:
            return page_size, available_width

    custom_width = required_width + (PAGE_MARGIN * 2)
    custom_height = landscape(A3)[1]
    return (custom_width, custom_height), required_width


def build_column_widths(
    rows: list[list[str]],
    group_ranges: list[tuple[int, int, str]],
    available_width: float,
) -> list[float]:
    column_count = max(len(row) for row in rows)
    widths: list[float] = []
    for col_idx in range(column_count):
        is_group_label_col = any(start == col_idx for start, _, _ in group_ranges)
        text_lengths = [len(format_value(row[col_idx])) for row in rows if col_idx < len(row)]
        max_len = max(text_lengths or [0])

        if is_group_label_col:
            preferred = min(max(110, max_len * 5.0 + 18), 180)
        else:
            preferred = min(max(52, max_len * 4.3 + 14), 78)
        widths.append(preferred)

    total_width = sum(widths)
    if total_width <= 0:
        return [available_width / column_count] * column_count

    scale = available_width / total_width
    scaled_widths = [width * scale for width in widths]
    difference = available_width - sum(scaled_widths)
    scaled_widths[-1] += difference
    return scaled_widths


def build_styles() -> tuple[ParagraphStyle, ParagraphStyle, ParagraphStyle]:
    stylesheet = getSampleStyleSheet()
    body_left = ParagraphStyle(
        "BodyLeft",
        parent=stylesheet["BodyText"],
        fontName="Helvetica",
        fontSize=DEFAULT_FONT_SIZE,
        leading=11,
        alignment=TA_LEFT,
        spaceAfter=0,
        spaceBefore=0,
    )
    body_center = ParagraphStyle(
        "BodyCenter",
        parent=body_left,
        alignment=TA_CENTER,
    )
    header_style = ParagraphStyle(
        "Header",
        parent=body_center,
        fontName="Helvetica-Bold",
        fontSize=DEFAULT_FONT_SIZE,
        leading=11,
    )
    return body_left, body_center, header_style


def build_table_data(
    rows: list[list[str]],
    group_ranges: list[tuple[int, int, str]],
) -> list[list[Paragraph]]:
    body_left, body_center, header_style = build_styles()
    group_starts = {start for start, _, _ in group_ranges}

    table_data: list[list[Paragraph]] = []
    for row_index, row in enumerate(rows):
        rendered_row: list[Paragraph] = []
        for col_index, value in enumerate(row):
            safe_value = escape(format_value(value)).replace("\n", "<br/>") or "&nbsp;"
            if row_index == 0:
                style = header_style
            elif col_index in group_starts:
                style = body_left
            else:
                style = body_center
            rendered_row.append(Paragraph(safe_value, style))
        table_data.append(rendered_row)
    return table_data


def build_table_style(
    row_count: int,
    group_ranges: list[tuple[int, int, str]],
) -> TableStyle:
    style_commands = [
        ("BOX", (0, 0), (-1, -1), 0.9, colors.HexColor("#3A3A3A")),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#9A9A9A")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EFE7DA")),
        ("LINEBELOW", (0, 0), (-1, 0), 1.0, colors.HexColor("#3A3A3A")),
    ]

    for row_index in range(1, row_count):
        if row_index % 2 == 0:
            style_commands.append(
                ("BACKGROUND", (0, row_index), (-1, row_index), colors.HexColor("#FCFAF6"))
            )

    for group_index, (start_col, end_col, _) in enumerate(group_ranges):
        fill = GROUP_COLORS[group_index % len(GROUP_COLORS)]
        style_commands.extend(
            [
                ("BACKGROUND", (start_col, 0), (end_col, 0), fill),
                ("LINEBEFORE", (start_col, 0), (start_col, row_count - 1), 1.1, colors.HexColor("#3A3A3A")),
                ("LINEAFTER", (end_col, 0), (end_col, row_count - 1), 1.1, colors.HexColor("#3A3A3A")),
            ]
        )

    return TableStyle(style_commands)


def add_page_number(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica", 9)
    canvas.drawRightString(doc.pagesize[0] - PAGE_MARGIN, PAGE_MARGIN * 0.65, f"Page {doc.page}")
    canvas.restoreState()


def render_excel_to_pdf(excel_path: Path, output_path: Path, sheet_name: str | None = None) -> Path:
    active_sheet_name, rows = load_sheet_rows(excel_path, sheet_name)
    if not rows:
        raise ValueError("The Excel sheet is empty.")

    group_ranges = detect_group_ranges(rows[0])
    required_width = sum(build_column_widths(rows, group_ranges, available_width=1))
    page_size, available_width = choose_page_size(required_width)
    column_widths = build_column_widths(rows, group_ranges, available_width=available_width)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(
        str(output_path),
        pagesize=page_size,
        leftMargin=PAGE_MARGIN,
        rightMargin=PAGE_MARGIN,
        topMargin=PAGE_MARGIN,
        bottomMargin=PAGE_MARGIN,
    )

    title_style = getSampleStyleSheet()["Title"]
    title_style.fontName = "Helvetica-Bold"
    title_style.fontSize = 14
    title_style.leading = 18
    title_style.textColor = colors.HexColor("#2D2A26")

    subtitle_style = getSampleStyleSheet()["BodyText"]
    subtitle_style.fontName = "Helvetica"
    subtitle_style.fontSize = 10
    subtitle_style.leading = 12
    subtitle_style.textColor = colors.HexColor("#5A544D")

    story = [
        Paragraph(escape(excel_path.stem.replace("_", " ").title()), title_style),
        Paragraph(escape(f"Sheet: {active_sheet_name}"), subtitle_style),
        Spacer(1, 10),
    ]

    table = Table(
        build_table_data(rows, group_ranges),
        colWidths=column_widths,
        repeatRows=1,
        splitByRow=1,
        hAlign="LEFT",
    )
    table.setStyle(build_table_style(len(rows), group_ranges))
    story.append(table)

    document.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    return output_path


def main() -> None:
    args = parse_args()
    excel_path = Path(args.excel_path)
    if not excel_path.exists():
        raise FileNotFoundError(f"Excel file not found: {excel_path}")

    output_path = Path(args.output_path) if args.output_path else excel_path.with_suffix(".pdf")
    result = render_excel_to_pdf(excel_path, output_path, args.sheet)
    print(f"PDF created: {result}")


if __name__ == "__main__":
    main()