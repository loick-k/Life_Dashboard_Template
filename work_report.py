from __future__ import annotations

from io import BytesIO

import pandas as pd
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app_clock import today_paris
from work_tracking import (
    DAILY_WORK_TARGET_HOURS,
    format_hour_decimal,
    format_signed_duration,
    week_bounds,
    work_balance_through_date,
    work_day_balance,
)


NAVY = colors.HexColor("#273248")
BLUE = colors.HexColor("#2563EB")
PALE_BLUE = colors.HexColor("#EAF2FF")
LIGHT_GREY = colors.HexColor("#F3F4F6")
MID_GREY = colors.HexColor("#6B7280")


def _duration_series(frame: pd.DataFrame) -> pd.Series:
    duration = pd.to_numeric(
        frame.get("work_duration_hours", frame.get("work_hours")), errors="coerce"
    )
    if "work_hours" in frame.columns:
        duration = duration.fillna(pd.to_numeric(frame["work_hours"], errors="coerce"))
    return duration


def _display_value(value) -> str:
    return "-" if value is None or pd.isna(value) or str(value).strip() == "" else str(value)


def _page_number(canvas, document):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MID_GREY)
    canvas.drawString(16 * mm, 9 * mm, "Life Dashboard - Rapport temps de travail")
    canvas.drawRightString(281 * mm, 9 * mm, f"Page {document.page}")
    canvas.restoreState()


def _duration_chart(frame: pd.DataFrame) -> Drawing:
    chart_frame = frame.copy()
    chart_frame["duration"] = _duration_series(chart_frame)
    chart_frame = chart_frame[chart_frame["duration"].notna()].tail(14)

    drawing = Drawing(735, 250)
    if chart_frame.empty:
        drawing.add(String(10, 125, "Aucune durée calculable sur la période.", fillColor=MID_GREY))
        return drawing

    chart = VerticalBarChart()
    chart.x = 55
    chart.y = 45
    chart.height = 165
    chart.width = 650
    chart.data = [chart_frame["duration"].astype(float).tolist()]
    chart.categoryAxis.categoryNames = [
        value.strftime("%d/%m") for value in chart_frame["entry_date"]
    ]
    chart.categoryAxis.labels.fontName = "Helvetica"
    chart.categoryAxis.labels.fontSize = 7
    chart.categoryAxis.labels.angle = 35
    chart.categoryAxis.labels.dy = -10
    chart.valueAxis.valueMin = 0
    chart.valueAxis.valueMax = max(9, float(chart_frame["duration"].max()) + 1)
    chart.valueAxis.valueStep = 1
    chart.valueAxis.labels.fontName = "Helvetica"
    chart.valueAxis.labels.fontSize = 8
    chart.bars[0].fillColor = BLUE
    chart.bars[0].strokeColor = BLUE
    chart.barLabelFormat = "%0.1f h"
    chart.barLabels.fontName = "Helvetica"
    chart.barLabels.fontSize = 7
    chart.barLabels.fillColor = NAVY
    chart.barLabels.nudge = 6
    drawing.add(chart)
    drawing.add(String(8, 218, "Heures", fontName="Helvetica", fontSize=8, fillColor=MID_GREY))
    return drawing


def build_work_report(df_entries: pd.DataFrame, report_date=None) -> bytes:
    """Construit le rapport PDF sans écrire les données personnelles sur disque."""
    report_date = report_date or today_paris()
    frame = df_entries.copy() if df_entries is not None else pd.DataFrame()
    if not frame.empty and "entry_date" in frame.columns:
        frame["entry_date"] = pd.to_datetime(frame["entry_date"], errors="coerce").dt.date
        frame = frame[frame["entry_date"].notna() & (frame["entry_date"] <= report_date)]

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=14 * mm,
        bottomMargin=16 * mm,
        title="Rapport temps de travail",
        author="Life Dashboard",
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="ReportTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=26,
        textColor=NAVY,
        alignment=TA_LEFT,
        spaceAfter=4 * mm,
    ))
    styles.add(ParagraphStyle(
        name="SectionTitle",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=17,
        textColor=NAVY,
        spaceBefore=4 * mm,
        spaceAfter=3 * mm,
    ))
    styles.add(ParagraphStyle(
        name="Metric",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=24,
        leading=28,
        textColor=BLUE,
        alignment=TA_CENTER,
    ))

    story = [
        Paragraph("Rapport du temps de travail", styles["ReportTitle"]),
        Paragraph(f"Situation au {report_date.strftime('%d/%m/%Y')}", styles["Normal"]),
        Spacer(1, 4 * mm),
    ]

    cumulative = work_balance_through_date(frame, report_date)
    monday, sunday = week_bounds(report_date)
    week = frame[
        (frame["entry_date"] >= monday) & (frame["entry_date"] <= sunday)
    ].copy() if not frame.empty else pd.DataFrame()
    week["duration"] = _duration_series(week) if not week.empty else pd.Series(dtype=float)
    week_total = float(week["duration"].dropna().sum()) if not week.empty else 0.0

    metric_table = Table(
        [
            ["Compteur cumulé", "Durée cette semaine", "Référence quotidienne"],
            [
                Paragraph(format_signed_duration(cumulative), styles["Metric"]),
                Paragraph(format_hour_decimal(week_total), styles["Metric"]),
                Paragraph(format_hour_decimal(DAILY_WORK_TARGET_HOURS), styles["Metric"]),
            ],
        ],
        colWidths=[82 * mm, 82 * mm, 82 * mm],
        rowHeights=[10 * mm, 18 * mm],
    )
    metric_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), NAVY),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#BFDBFE")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#BFDBFE")),
    ]))
    story.extend([metric_table, Paragraph("Types de journée", styles["SectionTitle"])])

    if frame.empty or "work_travel" not in frame.columns:
        story.append(Paragraph("Aucune journée de travail renseignée.", styles["Normal"]))
    else:
        types = frame["work_travel"].fillna("Non renseigné").replace("", "Non renseigné")
        type_rows = [["Type de journée", "Nombre"]] + [
            [label, str(int(count))] for label, count in types.value_counts().items()
        ]
        type_table = Table(type_rows, colWidths=[90 * mm, 35 * mm], repeatRows=1)
        type_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BACKGROUND", (0, 1), (-1, -1), LIGHT_GREY),
            ("ALIGN", (1, 1), (1, -1), "CENTER"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.white),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(type_table)

    story.extend([
        Paragraph(
            f"Détail de la semaine du {monday.strftime('%d/%m/%Y')} au {sunday.strftime('%d/%m/%Y')}",
            styles["SectionTitle"],
        )
    ])
    weekly_rows = [["Date", "Type", "Début", "Fin matin", "Début après-midi", "Fin", "Durée", "Solde"]]
    if not week.empty:
        for _, row in week.sort_values("entry_date").iterrows():
            duration = row.get("duration")
            day_off = row.get("work_travel") == "Day off"
            balance = work_day_balance(duration, day_off=day_off) if pd.notna(duration) else None
            weekly_rows.append([
                row["entry_date"].strftime("%d/%m/%Y"),
                _display_value(row.get("work_travel")),
                _display_value(row.get("work_start_time")),
                _display_value(row.get("work_morning_end_time")),
                _display_value(row.get("work_afternoon_start_time")),
                _display_value(row.get("work_end_time")),
                format_hour_decimal(duration),
                format_signed_duration(balance),
            ])
    else:
        weekly_rows.append(["Aucune donnée cette semaine", "", "", "", "", "", "", ""])

    weekly_table = Table(
        weekly_rows,
        colWidths=[27 * mm, 36 * mm, 25 * mm, 29 * mm, 34 * mm, 25 * mm, 27 * mm, 27 * mm],
        repeatRows=1,
    )
    weekly_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_GREY]),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D1D5DB")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (2, 1), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([
        weekly_table,
        PageBreak(),
        Paragraph("Durée de travail", styles["ReportTitle"]),
        Paragraph("Quatorze dernières journées dont la durée est calculable", styles["Normal"]),
        Spacer(1, 4 * mm),
        _duration_chart(frame),
    ])

    document.build(story, onFirstPage=_page_number, onLaterPages=_page_number)
    return buffer.getvalue()
