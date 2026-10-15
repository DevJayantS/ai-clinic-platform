"""
Full Realistic Medical Report Suite Generator
Builds authentic, institutional medical reports for 4 synthetic patients:
- Blood Tests (CBC, Fasting Glucose, Lipid Profile, CMP)
- Allergy Reports (Comprehensive Panel, Specific IgE, Epicutaneous Skin-Prick)
- Radiology Reports (Chest Radiograph 2-View, Abdominal CT, Lumbar Spine MRI, Brain MRI)
- Inpatient Discharge Summaries (Internal Medicine, Emergency Encounter, Post-Surgical)
Utilizes ReportLab with NumberedCanvas for PDFs and python-docx for Word documents.
"""

import os
import sys
from typing import Dict, List, Any

# Ensure project root is in sys.path
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from reportlab.platypus import Paragraph, Spacer, PageBreak, KeepTogether, HRFlowable
from reportlab.lib import colors
from backend.app.services.realistic_report_builder import (
    get_medical_styles,
    create_header_elements,
    create_demographics_box,
    create_lab_results_table,
    create_signature_block,
    build_pdf_document,
    PRIMARY_COLOR,
    SECONDARY_COLOR
)
from backend.synthetic_data_generator import write_sample_docx, write_sample_txt


def generate_all_realistic_reports(target_dir: str):
    os.makedirs(target_dir, exist_ok=True)
    styles = get_medical_styles()

    # =========================================================================
    # PATIENT 1: PAT-2001 - Arthur Pendelton (Male, Age 54, DOB: 1972-04-12)
    # Target searches: 'allergy' (multiple docs), 'discharged', 'blood'
    # =========================================================================
    p1_dir = os.path.join(target_dir, "PAT-2001")
    os.makedirs(p1_dir, exist_ok=True)

    # 1. CBC Blood Test (PDF)
    p1_doc1 = os.path.join(p1_dir, "PAT2001_CBC_Blood_Test.pdf")
    p1_doc1_elements = []
    p1_doc1_elements.extend(create_header_elements(
        "ST. JUDE METROPOLITAN HOSPITAL",
        "DEPARTMENT OF PATHOLOGY & CLINICAL HEMATOLOGY",
        "AUTOMATED COMPLETE BLOOD COUNT (CBC) WITH DIFFERENTIAL",
        styles=styles
    ))
    p1_doc1_elements.append(create_demographics_box(
        "Arthur Pendelton", "PAT-2001-9872", "1972-04-12", "54Y / Male",
        "Dr. Sarah Jenkins, MD", "ACC-2026-88102", "2026-08-14 08:45 EST",
        "Whole Blood (EDTA Lav Top)", styles=styles
    ))
    p1_doc1_elements.append(Spacer(1, 10))
    p1_doc1_elements.append(Paragraph("<b>CLINICAL INDICATION & REASON FOR EXAM:</b>", styles['SectionHeading']))
    p1_doc1_elements.append(Paragraph(
        "Annual wellness physical examination and routine monitoring. "
        "Patient in usual state of health. <b>No known drug allergy noted</b> in intake questionnaire. "
        "Occasional mild seasonal allergy symptoms noted during spring months.",
        styles['ClinicalBody']
    ))
    p1_doc1_elements.append(Spacer(1, 8))
    p1_doc1_elements.append(Paragraph("<b>HEMATOLOGY QUANTITATIVE FINDINGS:</b>", styles['SectionHeading']))

    cbc_headers = ["TEST / ANALYTE", "RESULT", "UNITS", "REFERENCE RANGE", "FLAG"]
    cbc_rows = [
        ["White Blood Cell Count (WBC)", "6.8", "x10^3/uL", "4.5 - 11.0", "NORMAL"],
        ["Red Blood Cell Count (RBC)", "4.85", "x10^6/uL", "4.30 - 5.90", "NORMAL"],
        ["Hemoglobin (Hgb)", "15.2", "g/dL", "13.5 - 17.5", "NORMAL"],
        ["Hematocrit (Hct)", "44.8", "%", "41.0 - 50.0", "NORMAL"],
        ["Mean Corpuscular Volume (MCV)", "92.4", "fL", "80.0 - 100.0", "NORMAL"],
        ["Mean Corpuscular Hgb (MCH)", "31.3", "pg", "27.0 - 33.0", "NORMAL"],
        ["Platelet Count", "245", "x10^3/uL", "150 - 450", "NORMAL"],
        ["Neutrophils (Automated)", "58.0", "%", "40.0 - 70.0", "NORMAL"],
        ["Lymphocytes (Automated)", "32.0", "%", "20.0 - 40.0", "NORMAL"],
        ["Monocytes (Automated)", "5.5", "%", "2.0 - 8.0", "NORMAL"],
        ["Eosinophils (Automated)", "4.2", "%", "1.0 - 4.0", "MILD ELEVATION*"],
        ["Basophils (Automated)", "0.3", "%", "0.0 - 1.5", "NORMAL"],
    ]
    p1_doc1_elements.append(create_lab_results_table(cbc_headers, cbc_rows, styles=styles))
    p1_doc1_elements.append(Spacer(1, 8))
    p1_doc1_elements.append(Paragraph("<b>PATHOLOGIST INTERPRETATION & COMMENTS:</b>", styles['SectionHeading']))
    p1_doc1_elements.append(Paragraph(
        "Peripheral red cell morphology demonstrates normocytic, normochromic erythrocytes. "
        "Platelet morphology unremarkable with adequate clumping. "
        "Mild peripheral eosinophilia noted (4.2%). In light of patient reports of chronic sinus congestion, "
        "underlying seasonal allergy is clinically suspected. Recommend correlation with clinical symptoms.",
        styles['ClinicalBody']
    ))
    p1_doc1_elements.append(create_signature_block(
        "Dr. Marcus Vance", "MD, FCAP (Chief of Hematopathology)", "NPI: 1487293810", "2026-08-14 11:20:04", styles=styles
    ))
    build_pdf_document(p1_doc1, p1_doc1_elements)

    # 2. Multi-Page Allergy Panel Report (PDF, 2 Pages)
    p1_doc2 = os.path.join(p1_dir, "PAT2001_Allergy_Panel_Report.pdf")
    p1_doc2_elements = []
    
    # Page 1
    p1_doc2_elements.extend(create_header_elements(
        "METROPOLITAN ALLERGY & CLINICAL IMMUNOLOGY CENTER",
        "DIVISION OF ENVIRONMENTAL & MOLECULAR ALLERGY DIAGNOSTICS",
        "COMPREHENSIVE ALLERGEN-SPECIFIC IgE IMMUNOBLOT PROFILE",
        styles=styles
    ))
    p1_doc2_elements.append(create_demographics_box(
        "Arthur Pendelton", "PAT-2001-9872", "1972-04-12", "54Y / Male",
        "Dr. Elena Rostova, MD, FAAAAI", "ALG-2026-44019", "2026-08-20 14:15 EST",
        "Serum (Gold SST Gel Tube)", styles=styles
    ))
    p1_doc2_elements.append(Spacer(1, 8))
    p1_doc2_elements.append(Paragraph("<b>CLINICAL ALLERGY EVALUATION & INDICATION:</b>", styles['SectionHeading']))
    p1_doc2_elements.append(Paragraph(
        "Comprehensive allergy testing was performed following referral from internal medicine. "
        "Patient reports persistent rhinoconjunctivitis, bronchial hypersensitivity, and history of allergies. "
        "Prior penicillin exposure triggered urticarial drug allergy reaction. "
        "Safety Notice: Severe drug allergy alert highlighted in chart.",
        styles['ClinicalBody']
    ))
    p1_doc2_elements.append(Spacer(1, 8))
    p1_doc2_elements.append(Paragraph("<b>SECTION I: ENVIRONMENTAL & INHALANT ALLERGEN PANEL:</b>", styles['SectionHeading']))

    inhalant_headers = ["ALLERGEN SOURCE", "RESULT", "UNITS", "CLASS", "INTERPRETATION"]
    inhalant_rows = [
        ["Dermatophagoides pteronyssinus (Dust Mite)", "18.4", "kUA/L", "Class 4", "VERY HIGHLY SENSITIZED*"],
        ["Dermatophagoides farinae (Dust Mite)", "16.2", "kUA/L", "Class 4", "VERY HIGHLY SENSITIZED*"],
        ["Timothy Grass (Phleum pratense)", "7.8", "kUA/L", "Class 3", "HIGHLY SENSITIZED*"],
        ["Bermuda Grass (Cynodon dactylon)", "6.1", "kUA/L", "Class 3", "HIGHLY SENSITIZED*"],
        ["Birch Tree Pollen (Betula verrucosa)", "3.9", "kUA/L", "Class 3", "MODERATE POSITIVE*"],
        ["Oak Tree Pollen (Quercus alba)", "1.2", "kUA/L", "Class 2", "LOW POSITIVE*"],
        ["Cat Dander Epithelium (Fel d 1)", "0.15", "kUA/L", "Class 0/1", "EQUIVOCAL / NEGATIVE"],
        ["Dog Dander Epithelium (Can f 1)", "0.08", "kUA/L", "Class 0", "NEGATIVE"],
        ["Alternaria alternata (Mold)", "0.22", "kUA/L", "Class 0/1", "EQUIVOCAL / NEGATIVE"]
    ]
    p1_doc2_elements.append(create_lab_results_table(inhalant_headers, inhalant_rows, col_widths=[185, 65, 75, 75, 140], styles=styles))
    
    # Page Break to ensure true Multi-Page layout
    p1_doc2_elements.append(PageBreak())

    # Page 2
    p1_doc2_elements.extend(create_header_elements(
        "METROPOLITAN ALLERGY & CLINICAL IMMUNOLOGY CENTER",
        "DIVISION OF ENVIRONMENTAL & MOLECULAR ALLERGY DIAGNOSTICS",
        "COMPREHENSIVE ALLERGEN-SPECIFIC IgE IMMUNOBLOT PROFILE (CONTINUED)",
        styles=styles
    ))
    p1_doc2_elements.append(Paragraph("<b>SECTION II: FOOD ALLERGEN & CROSS-REACTIVE MARKERS:</b>", styles['SectionHeading']))
    food_headers = ["ALLERGEN SOURCE", "RESULT", "UNITS", "CLASS", "INTERPRETATION"]
    food_rows = [
        ["Peanut (Ara h 1, 2, 3)", "0.04", "kUA/L", "Class 0", "NEGATIVE"],
        ["Cow's Milk (Bos d 4, 5, 8)", "0.02", "kUA/L", "Class 0", "NEGATIVE"],
        ["Egg White (Gal d 1, 2)", "0.05", "kUA/L", "Class 0", "NEGATIVE"],
        ["Wheat (Tri a 19)", "0.11", "kUA/L", "Class 0", "NEGATIVE"],
        ["Soybean (Gly m 5, 6)", "0.08", "kUA/L", "Class 0", "NEGATIVE"],
        ["Shrimp / Shellfish (Cra c 1)", "0.06", "kUA/L", "Class 0", "NEGATIVE"]
    ]
    p1_doc2_elements.append(create_lab_results_table(food_headers, food_rows, col_widths=[185, 65, 75, 75, 140], styles=styles))
    p1_doc2_elements.append(Spacer(1, 10))
    p1_doc2_elements.append(Paragraph("<b>CLINICAL IMPRESSION & RECOMMENDATIONS:</b>", styles['SectionHeading']))
    p1_doc2_elements.append(Paragraph(
        "1. Marked perennial indoor environmental allergy to house dust mites (Class 4).<br/>"
        "2. Significant seasonal allergy to grass pollens and tree pollens contributing to spring rhinitis.<br/>"
        "3. Environmental allergen mitigation recommended: impermeable mattress encasings, nasal corticosteroids, "
        "and sublingual allergy immunotherapy consultation.<br/>"
        "4. Follow-up consultation scheduled in metropolitan allergy clinic.",
        styles['ClinicalBody']
    ))
    p1_doc2_elements.append(create_signature_block(
        "Dr. Elena Rostova", "MD, FAAAAI (Board Certified Allergist)", "NPI: 1982736451", "2026-08-20 17:05:12", styles=styles
    ))
    build_pdf_document(p1_doc2, p1_doc2_elements)

    # 3. Chest X-Ray Radiology Report (PDF)
    p1_doc3 = os.path.join(p1_dir, "PAT2001_Chest_Xray_Report.pdf")
    p1_doc3_elements = []
    p1_doc3_elements.extend(create_header_elements(
        "MEMORIAL RADIOLOGY & DIAGNOSTIC IMAGING INSTITUTE",
        "DIVISION OF THORACIC & CARDIOVASCULAR RADIOLOGY",
        "DIAGNOSTIC RADIOLOGY REPORT: CHEST (PA & LATERAL)",
        styles=styles
    ))
    p1_doc3_elements.append(create_demographics_box(
        "Arthur Pendelton", "PAT-2001-9872", "1972-04-12", "54Y / Male",
        "Dr. Sarah Jenkins, MD", "RAD-2026-10928", "2026-08-22 10:15 EST",
        "Chest 2-Views (PA and Lateral)", styles=styles
    ))
    p1_doc3_elements.append(Spacer(1, 10))
    p1_doc3_elements.append(Paragraph("<b>CLINICAL INDICATION:</b>", styles['SectionHeading']))
    p1_doc3_elements.append(Paragraph(
        "Persistent dry cough, mild dyspnea on exertion. Evaluate for pulmonary infiltrate, pneumothorax, "
        "or congestive heart failure. Patient denies fever or purulent sputum. "
        "Patient has known seasonal allergy with associated upper airway reactive cough.",
        styles['ClinicalBody']
    ))
    p1_doc3_elements.append(Spacer(1, 6))
    p1_doc3_elements.append(Paragraph("<b>TECHNIQUE & COMPARISON:</b>", styles['SectionHeading']))
    p1_doc3_elements.append(Paragraph(
        "Standard posteroanterior and lateral projections of the chest obtained at full inspiration. "
        "Dose area product: 0.12 dGy*cm2. Comparison made to prior radiograph dated 2024-05-18.",
        styles['ClinicalBody']
    ))
    p1_doc3_elements.append(Spacer(1, 6))
    p1_doc3_elements.append(Paragraph("<b>DETAILED FINDINGS:</b>", styles['SectionHeading']))
    p1_doc3_elements.append(Paragraph(
        "<b>LUNGS & AIRWAYS:</b> Lungs are clear and fully expanded bilaterally. No focal airspace consolidation, "
        "mass, or suspicious pulmonary nodule identified. Bronchovascular markings are within normal limits. "
        "Trachea is midline and patent.<br/>"
        "<b>PLEURA:</b> Costophrenic sulci and cardiophrenic angles are sharp and clear. No pleural effusion or pneumothorax.<br/>"
        "<b>HEART & MEDIASTINUM:</b> Cardiothoracic ratio is normal (0.46). Cardiac silhouette is normal in size and configuration. "
        "Mediastinal and hilar contours are unremarkable. Thoracic aorta is non-dilated.<br/>"
        "<b>OSSEOUS STRUCTURES:</b> Visualized osseous structures demonstrate no acute fracture or aggressive lytic or blastic lesions. "
        "Mild degenerative osteophytes noted in mid thoracic spine.",
        styles['ClinicalBody']
    ))
    p1_doc3_elements.append(Spacer(1, 6))
    p1_doc3_elements.append(Paragraph("<b>IMPRESSION:</b>", styles['SectionHeading']))
    p1_doc3_elements.append(Paragraph(
        "1. No acute cardiopulmonary abnormality.<br/>"
        "2. No evidence of pneumonia, pulmonary congestion, or pleural effusion.<br/>"
        "3. Cough likely secondary to upper airway cough syndrome and allergic rhinitis.",
        styles['ClinicalBodyBold']
    ))
    p1_doc3_elements.append(create_signature_block(
        "Dr. Jonathan Hayes", "MD, ABR (Staff Radiologist)", "NPI: 1729018472", "2026-08-22 11:40:19", styles=styles
    ))
    build_pdf_document(p1_doc3, p1_doc3_elements)

    # 4. Discharge Summary (DOCX)
    p1_doc4 = os.path.join(p1_dir, "PAT2001_General_Medicine_Discharge_Summary.docx")
    write_sample_docx(
        p1_doc4,
        [
            "MASSACHUSETTS GENERAL INPATIENT ENCOUNTER DIVISION",
            "DEPARTMENT OF INTERNAL MEDICINE — HOSPITAL DISCHARGE SUMMARY",
            "*** SYNTHETIC CLINICAL TEST RECORD — FOR SEARCH SYSTEM VERIFICATION ONLY ***",
            "PATIENT IDENTIFICATION:",
            "Patient Name: Arthur Pendelton | MRN: PAT-2001-9872 | DOB: 1972-04-12 | Age: 54 | Sex: Male",
            "Admission Date: 2026-09-02 | Discharge Date: 2026-09-05 | Attending Physician: Dr. Marcus Vance, MD",
            "ADMISSION DIAGNOSIS: Acute exacerbation of chronic obstructive bronchitis, dehydration, severe sinus congestion.",
            "DISCHARGE DIAGNOSIS: Resolved acute bronchial bronchitis, controlled allergic rhinoconjunctivitis.",
            "ALLERGY SAFETY NOTICE: Documented severe allergy to penicillin and amoxicillin (anaphylaxis).",
            "HOSPITAL COURSE SUMMARY:",
            "The patient was admitted through internal medicine services after presenting with progressive wheezing. "
            "Patient reports a history of allergies affecting respiratory status. During hospital stay, nebulized bronchodilators "
            "and intravenous hydration were administered. Sputum cultures showed normal flora. Sputum eosinophils elevated.",
            "DISCHARGE CONDITION & STABILITY:",
            "The patient was discharged in stable condition with vitals normal: BP 124/78 mmHg, HR 72 bpm, SpO2 98% room air.",
            "DISCHARGE MEDICATIONS: Budesonide/formoterol inhaler, Montelukast 10mg daily, Cetirizine 10mg daily.",
            "FOLLOW-UP APPOINTMENT: Follow-up scheduled with primary care in 14 days and allergy clinic in 30 days."
        ]
    )

    # =========================================================================
    # PATIENT 2: PAT-2002 - Eleanor Vance (Female, Age 41, DOB: 1985-08-23)
    # Target searches: 'CT imaging shows no acute abnormality', 'discharged', 'allergy'
    # =========================================================================
    p2_dir = os.path.join(target_dir, "PAT-2002")
    os.makedirs(p2_dir, exist_ok=True)

    # 1. Specific IgE Allergy Blood Test (PDF)
    p2_doc1 = os.path.join(p2_dir, "PAT2002_Specific_IgE_Blood_Test.pdf")
    p2_doc1_elements = []
    p2_doc1_elements.extend(create_header_elements(
        "QUEST ADVANCED CLINICAL IMMUNOLOGY LABS",
        "DIVISION OF ALLERGEN MOLECULAR DIAGNOSTICS",
        "QUANTITATIVE SERUM SPECIFIC IgE ASSAY REPORT",
        styles=styles
    ))
    p2_doc1_elements.append(create_demographics_box(
        "Eleanor Vance", "PAT-2002-1140", "1985-08-23", "41Y / Female",
        "Dr. Gregory Thorne, MD", "ACC-2026-77391", "2026-07-12 10:20 EST",
        "Serum (Gold SST Tube)", styles=styles
    ))
    p2_doc1_elements.append(Spacer(1, 10))
    p2_doc1_elements.append(Paragraph("<b>CLINICAL INDICATION & ALLERGY SUMMARY:</b>", styles['SectionHeading']))
    p2_doc1_elements.append(Paragraph(
        "Diagnostic allergy testing was performed following repeated episodes of acute facial edema and hives. "
        "Patient has a suspected history of allergies to environmental latex and tree nuts.",
        styles['ClinicalBody']
    ))
    p2_doc1_elements.append(Spacer(1, 8))
    p2_doc1_elements.append(Paragraph("<b>QUANTITATIVE IMMUNOGLOBULIN & ALLERGEN RESULTS:</b>", styles['SectionHeading']))

    ige_headers = ["ALLERGEN / COMPONENT", "RESULT", "UNITS", "CLASS", "INTERPRETATION"]
    ige_rows = [
        ["Total Serum IgE", "418.0", "IU/mL", "High", "SIGNIFICANTLY ELEVATED*"],
        ["Natural Latex (Hev b 1, 3, 5, 6)", "14.2", "kUA/L", "Class 3", "HIGHLY SENSITIZED*"],
        ["Walnut (Jug r 1)", "8.9", "kUA/L", "Class 3", "HIGHLY SENSITIZED*"],
        ["Cashew Nut (Ana o 3)", "5.2", "kUA/L", "Class 3", "MODERATE POSITIVE*"],
        ["Hazelnut (Cor a 9, 14)", "1.8", "kUA/L", "Class 2", "LOW POSITIVE*"],
        ["Soybean Component (Gly m 4)", "0.22", "kUA/L", "Class 0/1", "EQUIVOCAL"]
    ]
    p2_doc1_elements.append(create_lab_results_table(ige_headers, ige_rows, styles=styles))
    p2_doc1_elements.append(Spacer(1, 8))
    p2_doc1_elements.append(Paragraph("<b>ALLERGIST INTERPRETATION:</b>", styles['SectionHeading']))
    p2_doc1_elements.append(Paragraph(
        "Results establish positive IgE-mediated allergy to natural rubber latex and tree nuts (walnut/cashew). "
        "Strict allergen avoidance required. EpiPen prescription renewed with emergency action protocol.",
        styles['ClinicalBody']
    ))
    p2_doc1_elements.append(create_signature_block(
        "Dr. Claudia Simmons", "MD, PhD, FAAAAI", "NPI: 1840291740", "2026-07-12 15:45:10", styles=styles
    ))
    build_pdf_document(p2_doc1, p2_doc1_elements)

    # 2. Fasting Lipid Profile (PDF)
    p2_doc2 = os.path.join(p2_dir, "PAT2002_Lipid_Profile_Report.pdf")
    p2_doc2_elements = []
    p2_doc2_elements.extend(create_header_elements(
        "ST. JUDE METROPOLITAN HOSPITAL",
        "DEPARTMENT OF CLINICAL BIOCHEMISTRY",
        "FASTING LIPID PROFILE & ATHEROSCLEROTIC CARDIOVASCULAR RISK",
        styles=styles
    ))
    p2_doc2_elements.append(create_demographics_box(
        "Eleanor Vance", "PAT-2002-1140", "1985-08-23", "41Y / Female",
        "Dr. Gregory Thorne, MD", "ACC-2026-99201", "2026-07-14 07:30 EST",
        "Fasting Serum (12-hr Fast)", styles=styles
    ))
    p2_doc2_elements.append(Spacer(1, 10))
    p2_doc2_elements.append(Paragraph("<b>CLINICAL INDICATION:</b>", styles['SectionHeading']))
    p2_doc2_elements.append(Paragraph(
        "Routine preventative cardiovascular risk screening. Patient denies history of premature CAD. "
        "Medication history reviewed; patient denies any known allergy to statin lipid medications.",
        styles['ClinicalBody']
    ))
    p2_doc2_elements.append(Spacer(1, 8))
    p2_doc2_elements.append(Paragraph("<b>LIPID PANEL QUANTITATIVE VALUES:</b>", styles['SectionHeading']))

    lipid_headers = ["TEST DESCRIPTION", "RESULT", "UNITS", "DESIRABLE RANGE", "RISK FLAG"]
    lipid_rows = [
        ["Total Cholesterol", "224", "mg/dL", "< 200", "ELEVATED*"],
        ["Triglycerides", "168", "mg/dL", "< 150", "BORDERLINE HIGH*"],
        ["HDL Cholesterol (Good)", "58", "mg/dL", "> 50", "OPTIMAL"],
        ["LDL Cholesterol (Calc)", "132", "mg/dL", "< 100", "ELEVATED*"],
        ["Non-HDL Cholesterol", "166", "mg/dL", "< 130", "ELEVATED*"],
        ["Cholesterol / HDL Ratio", "3.86", "ratio", "< 4.0", "DESIRABLE"]
    ]
    p2_doc2_elements.append(create_lab_results_table(lipid_headers, lipid_rows, styles=styles))
    p2_doc2_elements.append(Spacer(1, 8))
    p2_doc2_elements.append(Paragraph("<b>LABORATORY DIRECTOR COMMENTARY:</b>", styles['SectionHeading']))
    p2_doc2_elements.append(Paragraph(
        "Mild hyperlipidemia with moderate elevation in total cholesterol and calculated LDL. "
        "Recommend therapeutic lifestyle modifications, dietary low-saturated-fat intervention, and repeat in 6 months.",
        styles['ClinicalBody']
    ))
    p2_doc2_elements.append(create_signature_block(
        "Dr. Arthur Bennett", "MD, DABCC (Laboratory Director)", "NPI: 1092837401", "2026-07-14 09:12:00", styles=styles
    ))
    build_pdf_document(p2_doc2, p2_doc2_elements)

    # 3. CT Abdomen & Pelvis (DOCX)
    p2_doc3 = os.path.join(p2_dir, "PAT2002_CT_Abdomen_Scan.docx")
    write_sample_docx(
        p2_doc3,
        [
            "METROPOLITAN IMAGING & COMPUTED TOMOGRAPHY CENTER",
            "DEPARTMENT OF DIAGNOSTIC RADIOLOGY — CT SCAN OF ABDOMEN AND PELVIS WITH IV CONTRAST",
            "*** SYNTHETIC CLINICAL TEST RECORD — FOR SYSTEM VERIFICATION ONLY ***",
            "Patient Name: Eleanor Vance | MRN: PAT-2002-1140 | DOB: 1985-08-23 | Age: 41 | Sex: Female",
            "Exam Date: 2026-07-28 | Ordering Physician: Dr. Gregory Thorne, MD | Accession: CT-2026-44910",
            "CLINICAL INDICATION: Intermittent right upper quadrant pain and nausea. Rule out acute cholecystitis, appendicitis, or nephrolithiasis.",
            "ALLERGY STATUS & PREMEDICATION: The patient denies any known allergy to iodinated intravenous radiopaque contrast agents.",
            "TECHNIQUE: Helical axial tomographic images obtained from lung bases to pubic symphysis following administration of 85 mL Isovue-370 IV contrast.",
            "FINDINGS:",
            "LIVER: Normal in size, contour, and attenuation. No focal hepatic lesion or intrahepatic biliary ductal dilatation.",
            "GALLBLADDER & BILIARY: Gallbladder is distended with thin walls. No radiopaque gallstones or pericholecystic fluid.",
            "SPLEEN, PANCREAS, ADRENALS: Normal morphology and enhancement. No mass or inflammatory changes.",
            "KIDNEYS: Symmetrical nephrogram. No hydronephrosis, renal calculi, or perinephric stranding bilaterally.",
            "BOWEL & APPENDIX: Appendix visualized, measuring 5.2 mm in diameter without wall thickening or pericecal fat stranding. Colon is normal.",
            "PERITONEUM & LYMPHATICS: No ascites or free peritoneal air. No mesenteric or retroperitoneal lymphadenopathy.",
            "IMPRESSION:",
            "CT imaging shows no acute abnormality in the abdomen or pelvis.",
            "No evidence of acute appendicitis, cholecystitis, or bowel obstruction.",
            "Signed: Dr. Patricia Walsh, MD, Diagnostic Radiologist (NPI: 1629018471)"
        ]
    )

    # 4. Emergency Department Encounter (TXT)
    p2_doc4 = os.path.join(p2_dir, "PAT2002_Emergency_Department_Discharge_Summary.txt")
    write_sample_txt(
        p2_doc4,
        [
            "METROPOLITAN EMERGENCY MEDICINE CLINICAL ENCOUNTER",
            "EMERGENCY DEPARTMENT DISCHARGE SUMMARY — PAT-2002",
            "Patient: Eleanor Vance | DOB: 1985-08-23 | Age: 41 | Sex: Female",
            "ED Encounter Date: 2026-07-28 | Discharge Time: 21:45 EST",
            "CHIEF COMPLAINT: Epigastric discomfort and acute mild allergic rash following restaurant dinner.",
            "CLINICAL HISTORY & ALLERGIES: Patient evaluated for acute hives. Allergy testing was performed previously.",
            "HOSPITAL ENCOUNTER SUMMARY: Patient treated with oral diphenhydramine 25mg and famotidine 20mg. Symptoms resolved fully within 2 hours.",
            "DISCHARGE STATUS: The patient was discharged in stable condition. Tolerating clear liquids without distress.",
            "DISCHARGE INSTRUCTIONS: Follow up with allergy specialist. Avoid known food triggers."
        ]
    )

    # =========================================================================
    # PATIENT 3: PAT-2003 - Marcus Sterling (Male, Age 63, DOB: 1963-02-17)
    # ZERO ALLERGIES PATIENT — Strict negative control!
    # Contains: 'discharged', 'blood', 'glucose', 'MRI', 'lumbar', 'hernia'
    # MUST NOT CONTAIN ANY OCCURRENCE OF 'allergy' or 'allergies'!
    # =========================================================================
    p3_dir = os.path.join(target_dir, "PAT-2003")
    os.makedirs(p3_dir, exist_ok=True)

    # 1. Blood Glucose & HbA1c Panel (PDF)
    p3_doc1 = os.path.join(p3_dir, "PAT2003_Blood_Glucose_Monitoring_Report.pdf")
    p3_doc1_elements = []
    p3_doc1_elements.extend(create_header_elements(
        "ST. JUDE METROPOLITAN HOSPITAL",
        "DEPARTMENT OF ENDOCRINOLOGY & METABOLIC MEDICINE",
        "GLYCEMIC CONTROL & GLYCATED HEMOGLOBIN (HbA1c) PANEL",
        styles=styles
    ))
    p3_doc1_elements.append(create_demographics_box(
        "Marcus Sterling", "PAT-2003-8821", "1963-02-17", "63Y / Male",
        "Dr. Laura Chen, MD", "GLU-2026-33918", "2026-06-18 08:00 EST",
        "Fluoride Oxalate / Whole Blood EDTA", styles=styles
    ))
    p3_doc1_elements.append(Spacer(1, 10))
    p3_doc1_elements.append(Paragraph("<b>CLINICAL INDICATION:</b>", styles['SectionHeading']))
    p3_doc1_elements.append(Paragraph(
        "Type 2 diabetes mellitus monitoring and glycemic assessment. "
        "Patient presents for routine quarterly metabolic evaluation. Medication compliance confirmed with metformin.",
        styles['ClinicalBody']
    ))
    p3_doc1_elements.append(Spacer(1, 8))
    p3_doc1_elements.append(Paragraph("<b>ENDOCRINE LABORATORY QUANTITATIVE VALUES:</b>", styles['SectionHeading']))

    glu_headers = ["TEST DESCRIPTION", "RESULT", "UNITS", "REFERENCE RANGE", "FLAG"]
    glu_rows = [
        ["Fasting Plasma Glucose", "138", "mg/dL", "70 - 99", "ELEVATED*"],
        ["Hemoglobin A1c (HbA1c)", "7.2", "%", "< 5.7 (Good Control < 7.0)", "ABOVE GOAL*"],
        ["Estimated Average Glucose (eAG)", "160", "mg/dL", "< 126", "ELEVATED*"],
        ["Serum Insulin (Fasting)", "14.2", "uIU/mL", "2.6 - 24.9", "NORMAL"],
        ["C-Peptide", "2.8", "ng/mL", "1.1 - 4.4", "NORMAL"]
    ]
    p3_doc1_elements.append(create_lab_results_table(glu_headers, glu_rows, styles=styles))
    p3_doc1_elements.append(Spacer(1, 8))
    p3_doc1_elements.append(Paragraph("<b>ENDOCRINOLOGIST CLINICAL COMMENTS:</b>", styles['SectionHeading']))
    p3_doc1_elements.append(Paragraph(
        "Glycated hemoglobin level of 7.2% demonstrates moderate glycemic control. "
        "Continue current oral antihyperglycemic regimen. Emphasized dietary carbohydrate reduction and regular exercise.",
        styles['ClinicalBody']
    ))
    p3_doc1_elements.append(create_signature_block(
        "Dr. Laura Chen", "MD, FACE (Endocrinologist)", "NPI: 1390184729", "2026-06-18 10:45:22", styles=styles
    ))
    build_pdf_document(p3_doc1, p3_doc1_elements)

    # 2. Lumbar Spine MRI (PDF)
    p3_doc2 = os.path.join(p3_dir, "PAT2003_Lumbar_Spine_MRI_Report.pdf")
    p3_doc2_elements = []
    p3_doc2_elements.extend(create_header_elements(
        "MEMORIAL RADIOLOGY & DIAGNOSTIC IMAGING INSTITUTE",
        "DIVISION OF MUSCULOSKELETAL & NEURORADIOLOGY",
        "MAGNETIC RESONANCE IMAGING (MRI) OF LUMBAR SPINE",
        styles=styles
    ))
    p3_doc2_elements.append(create_demographics_box(
        "Marcus Sterling", "PAT-2003-8821", "1963-02-17", "63Y / Male",
        "Dr. Kevin Morales, MD", "MRI-2026-55102", "2026-06-25 13:30 EST",
        "Lumbar Spine Without Contrast (1.5T)", styles=styles
    ))
    p3_doc2_elements.append(Spacer(1, 10))
    p3_doc2_elements.append(Paragraph("<b>CLINICAL INDICATION:</b>", styles['SectionHeading']))
    p3_doc2_elements.append(Paragraph(
        "Progressive low back pain radiating into right gluteal and L5 dermatomal distribution. "
        "Assess for intervertebral disc herniation, spinal canal stenosis, or neural foraminal impingement.",
        styles['ClinicalBody']
    ))
    p3_doc2_elements.append(Spacer(1, 6))
    p3_doc2_elements.append(Paragraph("<b>TECHNIQUE:</b>", styles['SectionHeading']))
    p3_doc2_elements.append(Paragraph(
        "Sagittal and axial T1-weighted, T2-weighted, and STIR sequences obtained on high-field 1.5 Tesla MRI scanner.",
        styles['ClinicalBody']
    ))
    p3_doc2_elements.append(Spacer(1, 6))
    p3_doc2_elements.append(Paragraph("<b>DETAILED LEVEL-BY-LEVEL FINDINGS:</b>", styles['SectionHeading']))
    p3_doc2_elements.append(Paragraph(
        "<b>L1-L2, L2-L3:</b> Disc contour and signal preserved. Canal and neural foramina patent.<br/>"
        "<b>L3-L4:</b> Mild broad-based disc bulge with mild facet arthropathy. Mild central canal stenosis.<br/>"
        "<b>L4-L5:</b> Disc space narrowing with disc dehydration. Moderate circumferential disc bulge and right paracentral "
        "disc protrusion measuring 4 mm, contacting the exiting right L5 nerve root. Moderate right neural foraminal narrowing.<br/>"
        "<b>L5-S1:</b> Mild posterior disc osteophyte complex without significant canal narrowing.",
        styles['ClinicalBody']
    ))
    p3_doc2_elements.append(Spacer(1, 6))
    p3_doc2_elements.append(Paragraph("<b>IMPRESSION:</b>", styles['SectionHeading']))
    p3_doc2_elements.append(Paragraph(
        "1. Right paracentral disc protrusion at L4-L5 causing moderate right neural foraminal stenosis "
        "and contact with the right L5 nerve root, corresponding with patient's right-sided radiculopathy.<br/>"
        "2. Multilevel lumbar spondylosis with mild central spinal stenosis at L3-L4.",
        styles['ClinicalBodyBold']
    ))
    p3_doc2_elements.append(create_signature_block(
        "Dr. Kevin Morales", "MD (Neuroradiologist)", "NPI: 1550293817", "2026-06-25 15:10:45", styles=styles
    ))
    build_pdf_document(p3_doc2, p3_doc2_elements)

    # 3. Post-Surgical Discharge Summary (PDF)
    p3_doc3 = os.path.join(p3_dir, "PAT2003_Post_Surgical_Discharge_Summary.pdf")
    p3_doc3_elements = []
    p3_doc3_elements.extend(create_header_elements(
        "ST. JUDE METROPOLITAN HOSPITAL",
        "DEPARTMENT OF GENERAL SURGERY & INPATIENT CARE",
        "POST-SURGICAL INPATIENT DISCHARGE SUMMARY",
        styles=styles
    ))
    p3_doc3_elements.append(create_demographics_box(
        "Marcus Sterling", "PAT-2003-8821", "1963-02-17", "63Y / Male",
        "Dr. Rebecca Martinez, MD, FACS", "SURG-2026-0912", "2026-07-03 14:00 EST",
        "Inpatient Surgical Record", styles=styles
    ))
    p3_doc3_elements.append(Spacer(1, 10))
    p3_doc3_elements.append(Paragraph("<b>SURGICAL SUMMARY & OPERATIVE PROCEDURE:</b>", styles['SectionHeading']))
    p3_doc3_elements.append(Paragraph(
        "<b>Procedure:</b> Elective right inguinal hernia repair with prosthetic polypropylene mesh reinforcement.<br/>"
        "<b>Surgeon:</b> Dr. Rebecca Martinez, MD, FACS.<br/>"
        "<b>Anesthesia:</b> General endotracheal anesthesia. Estimated blood loss: 15 mL. Complications: None.",
        styles['ClinicalBody']
    ))
    p3_doc3_elements.append(Spacer(1, 8))
    p3_doc3_elements.append(Paragraph("<b>POST-OPERATIVE INPATIENT HOSPITAL COURSE:</b>", styles['SectionHeading']))
    p3_doc3_elements.append(Paragraph(
        "Patient transferred to surgical floor in comfortable condition. Post-operative pain controlled effectively "
        "with acetaminophen and oral ketorolac. Tolerated clear liquid diet progressing to regular diabetic diet. "
        "Ambulating independently without dizziness. Surgical incision clean, dry, and intact without hematoma or erythema.",
        styles['ClinicalBody']
    ))
    p3_doc3_elements.append(Spacer(1, 8))
    p3_doc3_elements.append(Paragraph("<b>DISCHARGE STATUS & INSTRUCTIONS:</b>", styles['SectionHeading']))
    p3_doc3_elements.append(Paragraph(
        "<b>The patient was discharged in stable condition</b> on post-operative day 1.<br/>"
        "<b>Vital Signs at Discharge:</b> BP 128/82 mmHg, HR 68 bpm, Temp 98.4 F, SpO2 99%.<br/>"
        "<b>Discharge Medications:</b> Acetaminophen 650mg Q6H PRN pain, Metformin 500mg BID with meals.<br/>"
        "<b>Activity:</b> No heavy lifting exceeding 10 pounds for 4 weeks. Surgical clinic follow-up in 10 days.",
        styles['ClinicalBody']
    ))
    p3_doc3_elements.append(create_signature_block(
        "Dr. Rebecca Martinez", "MD, FACS (Attending Surgeon)", "NPI: 1820194830", "2026-07-03 15:30:00", styles=styles
    ))
    build_pdf_document(p3_doc3, p3_doc3_elements)

    # =========================================================================
    # PATIENT 4: PAT-2004 - Sophia Lin (Female, Age 29, DOB: 1997-11-05)
    # Target searches: 'allergy', 'Skin-Prick', 'MRI', 'Brain'
    # =========================================================================
    p4_dir = os.path.join(target_dir, "PAT-2004")
    os.makedirs(p4_dir, exist_ok=True)

    # 1. Skin-Prick Allergy Diagnostic Report (TXT)
    p4_doc1 = os.path.join(p4_dir, "PAT2004_Skin_Prick_Allergy_Test.txt")
    write_sample_txt(
        p4_doc1,
        [
            "METROPOLITAN ALLERGY & IMMUNOLOGY AMBULATORY CLINIC",
            "EPICUTANEOUS SKIN-PRICK ALLERGY DIAGNOSTIC TEST REPORT",
            "Patient: Sophia Lin | MRN: PAT-2004-5501 | DOB: 1997-11-05 | Age: 29 | Sex: Female",
            "Exam Date: 2026-05-14 | Ordering Physician: Dr. Elena Rostova, MD",
            "TEST PROTOCOL: Epicutaneous skin-prick testing performed with histamine control (10 mg/mL) and saline negative control.",
            "CLINICAL HISTORY & ALLERGIES: Patient referred for evaluation of acute contact urticaria and suspected food allergies.",
            "SKIN TESTING OBSERVATIONS & WHEAL DIAMETER (mm):",
            "1. Histamine Dihydrochloride (Positive Control): 7.0 mm wheal / 24 mm flare [VALID TEST]",
            "2. Normal Saline (Negative Control): 0.0 mm wheal / 0.0 mm flare [NEGATIVE]",
            "3. Cat Dander (Felis catus): 6.5 mm wheal / 20 mm flare [POSITIVE ALLERGY]",
            "4. Birch Tree Pollen: 5.0 mm wheal / 16 mm flare [POSITIVE ALLERGY]",
            "5. Peanut Protein Extract: 0.0 mm wheal / 0.0 mm flare [NEGATIVE]",
            "6. Strawberry Extract: 0.0 mm wheal / 0.0 mm flare [NEGATIVE]",
            "DIAGNOSTIC IMPRESSION: Confirmed IgE-mediated environmental allergy to feline dander and tree pollens. Allergy immunotherapy discussed."
        ]
    )

    # 2. High-Resolution Brain MRI (PDF)
    p4_doc2 = os.path.join(p4_dir, "PAT2004_Brain_MRI_Report.pdf")
    p4_doc2_elements = []
    p4_doc2_elements.extend(create_header_elements(
        "MEMORIAL RADIOLOGY & DIAGNOSTIC IMAGING INSTITUTE",
        "DIVISION OF NEURORADIOLOGY & ADVANCED BRAIN IMAGING",
        "HIGH-RESOLUTION 3T MAGNETIC RESONANCE IMAGING (MRI) OF THE BRAIN",
        styles=styles
    ))
    p4_doc2_elements.append(create_demographics_box(
        "Sophia Lin", "PAT-2004-5501", "1997-11-05", "29Y / Female",
        "Dr. Daniel Foster, MD", "MRI-2026-99014", "2026-05-18 11:15 EST",
        "Brain MRI Without and With MultiHance IV Contrast (3.0 Tesla)", styles=styles
    ))
    p4_doc2_elements.append(Spacer(1, 10))
    p4_doc2_elements.append(Paragraph("<b>CLINICAL INDICATION & ALLERGY SAFETY:</b>", styles['SectionHeading']))
    p4_doc2_elements.append(Paragraph(
        "Investigation of recurrent unilateral throbbing headache with visual aura. "
        "Evaluate for intracranial aneurysm, mass lesion, or demyelinating plaques. "
        "Patient completed neuro-imaging questionnaire. <b>Patient reports a history of allergies</b> "
        "to environmental allergens and contact adhesives. No contraindications to gadolinium contrast.",
        styles['ClinicalBody']
    ))
    p4_doc2_elements.append(Spacer(1, 6))
    p4_doc2_elements.append(Paragraph("<b>TECHNIQUE & SEQUENCE PARAMETERS:</b>", styles['SectionHeading']))
    p4_doc2_elements.append(Paragraph(
        "3.0 Tesla MR imaging performed using 32-channel head coil. Multiplanar T1-weighted, T2-weighted, "
        "FLAIR, diffusion-weighted imaging (DWI), ADC maps, and 3D TOF intracranial MR angiography.",
        styles['ClinicalBody']
    ))
    p4_doc2_elements.append(Spacer(1, 6))
    p4_doc2_elements.append(Paragraph("<b>ANATOMIC FINDINGS:</b>", styles['SectionHeading']))
    p4_doc2_elements.append(Paragraph(
        "<b>BRAIN PARENCHYMA:</b> Cerebral hemispheres demonstrate normal gray-white matter differentiation. "
        "No acute territorial ischemia, hemorrhage, or mass effect. No evidence of multiple sclerosis demyelination plaques.<br/>"
        "<b>VENTRICLES & CISTERNS:</b> Ventricular system and basal cisterns are normal in caliber and configuration for age.<br/>"
        "<b>VASCULATURE:</b> 3D Time-of-Flight MRA reveals normal flow signal in the anterior and posterior circulations. "
        "No intracranial aneurysm or vascular malformation identified.<br/>"
        "<b>EXTRA-AXIAL SPACES:</b> Calvarium and skull base are intact. Paranasal sinuses and mastoid air cells are well-aerated.",
        styles['ClinicalBody']
    ))
    p4_doc2_elements.append(Spacer(1, 6))
    p4_doc2_elements.append(Paragraph("<b>IMPRESSION:</b>", styles['SectionHeading']))
    p4_doc2_elements.append(Paragraph(
        "1. Normal brain MRI and intracranial MR angiography.<br/>"
        "2. No intracranial mass lesion, acute infarct, or intracranial aneurysm.<br/>"
        "3. Findings compatible with migraine with aura.",
        styles['ClinicalBodyBold']
    ))
    p4_doc2_elements.append(create_signature_block(
        "Dr. Daniel Foster", "MD (Board Certified Neuroradiologist)", "NPI: 1672901842", "2026-05-18 13:40:11", styles=styles
    ))
    build_pdf_document(p4_doc2, p4_doc2_elements)

    # 3. Comprehensive Metabolic Panel & CBC (PDF)
    p4_doc3 = os.path.join(p4_dir, "PAT2004_Comprehensive_Metabolic_CBC_Panel.pdf")
    p4_doc3_elements = []
    p4_doc3_elements.extend(create_header_elements(
        "ST. JUDE METROPOLITAN HOSPITAL",
        "DEPARTMENT OF CLINICAL PATHOLOGY & METABOLIC LABORATORY",
        "COMPREHENSIVE METABOLIC PANEL (CMP-14) & COMPLETE BLOOD COUNT",
        styles=styles
    ))
    p4_doc3_elements.append(create_demographics_box(
        "Sophia Lin", "PAT-2004-5501", "1997-11-05", "29Y / Female",
        "Dr. Sarah Jenkins, MD", "LAB-2026-66120", "2026-05-20 08:30 EST",
        "Plasma (Lithium Heparin PST) & Whole Blood", styles=styles
    ))
    p4_doc3_elements.append(Spacer(1, 10))
    p4_doc3_elements.append(Paragraph("<b>CLINICAL INDICATION & REASON FOR EXAM:</b>", styles['SectionHeading']))
    p4_doc3_elements.append(Paragraph(
        "Pre-operative health baseline and routine metabolic screening. "
        "Patient denies chronic medical conditions. Allergy status reviewed: seasonal allergy symptoms managed with OTC antihistamines.",
        styles['ClinicalBody']
    ))
    p4_doc3_elements.append(Spacer(1, 8))
    p4_doc3_elements.append(Paragraph("<b>METABOLIC & HEMATOLOGY VALUES:</b>", styles['SectionHeading']))

    cmp_headers = ["ANALYTE / TEST", "RESULT", "UNITS", "REFERENCE INTERVAL", "STATUS"]
    cmp_rows = [
        ["Sodium", "141", "mmol/L", "136 - 145", "NORMAL"],
        ["Potassium", "4.2", "mmol/L", "3.5 - 5.1", "NORMAL"],
        ["Chloride", "102", "mmol/L", "98 - 107", "NORMAL"],
        ["Carbon Dioxide (CO2)", "26", "mmol/L", "22 - 29", "NORMAL"],
        ["Blood Urea Nitrogen (BUN)", "14", "mg/dL", "7 - 20", "NORMAL"],
        ["Serum Creatinine", "0.82", "mg/dL", "0.55 - 1.02", "NORMAL"],
        ["eGFR (CKD-EPI)", "> 90", "mL/min/1.73m2", "> 60", "OPTIMAL"],
        ["Glucose (Random)", "94", "mg/dL", "70 - 99", "NORMAL"],
        ["Calcium", "9.6", "mg/dL", "8.6 - 10.2", "NORMAL"],
        ["Total Protein", "7.1", "g/dL", "6.4 - 8.3", "NORMAL"],
        ["Albumin", "4.4", "g/dL", "3.5 - 5.0", "NORMAL"],
        ["Total Bilirubin", "0.6", "mg/dL", "0.2 - 1.2", "NORMAL"],
        ["Alkaline Phosphatase (ALP)", "64", "U/L", "44 - 121", "NORMAL"],
        ["Alanine Aminotransferase (ALT)", "18", "U/L", "7 - 35", "NORMAL"]
    ]
    p4_doc3_elements.append(create_lab_results_table(cmp_headers, cmp_rows, styles=styles))
    p4_doc3_elements.append(Spacer(1, 8))
    p4_doc3_elements.append(Paragraph("<b>CLINICAL BIOCHEMISTRY REVIEW:</b>", styles['SectionHeading']))
    p4_doc3_elements.append(Paragraph(
        "All electrolyte, renal, and hepatic function parameters demonstrate normal homeostatic values. "
        "Kidney and liver profiles are within optimal reference ranges.",
        styles['ClinicalBody']
    ))
    p4_doc3_elements.append(create_signature_block(
        "Dr. Marcus Vance", "MD, FCAP (Director of Clinical Chemistry)", "NPI: 1487293810", "2026-05-20 10:15:30", styles=styles
    ))
    build_pdf_document(p4_doc3, p4_doc3_elements)

    print("Successfully generated all 14 realistic medical reports in:", target_dir)


if __name__ == "__main__":
    out_dir = os.path.join(ROOT_DIR, "sample_medical_reports")
    generate_realistic_reports(out_dir)
