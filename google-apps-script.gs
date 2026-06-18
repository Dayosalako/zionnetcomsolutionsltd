// ============================================================================
// ZION NETCOM - CONTACT FORM BACKEND (Google Apps Script)
// ============================================================================
// This script receives form submissions from the contact page and:
// 1. Logs them to a Google Sheet
// 2. Sends an email notification to the admin
// 3. Sends an auto-reply to the submitter
//
// SETUP INSTRUCTIONS:
// 1. Go to https://script.google.com and create a new project
// 2. Paste this entire code into the editor
// 3. Replace ADMIN_EMAIL with your actual email
// 4. Run setupSheet() once to create the spreadsheet
// 5. Deploy as Web App (Deploy > New Deployment > Web App)
// 6. Set "Execute as: Me" and "Who has access: Anyone"
// 7. Copy the Web App URL and paste it into contact.html (GAS_URL variable)
// ============================================================================

const SHEET_NAME = 'Contact Submissions';
const ADMIN_EMAIL = 'info@zionnetcomsolutionsltd.com.ng'; // CHANGE THIS
const COMPANY_NAME = 'Zion Netcom Solutions';

// ============================================================================
// WEB APP ENTRY POINT - Handles POST requests from the contact form
// ============================================================================
function doPost(e) {
  try {
    // Parse the JSON payload
    const data = JSON.parse(e.postData.contents);

    // Validate required fields
    if (!data.name || !data.email || !data.inquiry || !data.message) {
      return jsonResponse({
        success: false,
        message: 'Missing required fields'
      }, 400);
    }

    // Get or create the spreadsheet
    const sheet = getOrCreateSheet();

    // Append the submission to the sheet
    const row = [
      new Date(),                           // Timestamp
      data.name,                            // Name
      data.email,                           // Email
      data.phone || '',                     // Phone
      data.inquiry,                         // Inquiry Type
      data.message,                         // Message
      data.source || '',                    // Source URL
      'New'                                 // Status
    ];
    sheet.appendRow(row);

    // Send email notification to admin
    sendAdminNotification(data);

    // Send auto-reply to submitter
    sendAutoReply(data);

    return jsonResponse({
      success: true,
      message: 'Inquiry received successfully'
    });

  } catch (error) {
    console.error('Error in doPost:', error);
    return jsonResponse({
      success: false,
      message: 'Server error: ' + error.toString()
    }, 500);
  }
}

// ============================================================================
// CORS PREFLIGHT - Handles OPTIONS requests for cross-origin requests
// ============================================================================
function doOptions(e) {
  return jsonResponse({ success: true });
}

// ============================================================================
// HELPER: Get or create the spreadsheet
// ============================================================================
function getOrCreateSheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('SHEET_ID');

  let spreadsheet;
  if (sheetId) {
    try {
      spreadsheet = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      // Sheet was deleted, create new one
      spreadsheet = null;
    }
  }

  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create(SHEET_NAME + ' - ' + COMPANY_NAME);
    sheetId = spreadsheet.getId();
    props.setProperty('SHEET_ID', sheetId);

    // Set up headers
    const sheet = spreadsheet.getActiveSheet();
    sheet.setName('Submissions');
    const headers = ['Timestamp', 'Name', 'Email', 'Phone', 'Inquiry Type', 'Message', 'Source', 'Status'];
    sheet.appendRow(headers);

    // Format header row
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#38B6FF');
    headerRange.setFontColor('#FFFFFF');

    // Auto-resize columns
    sheet.autoResizeColumns(1, headers.length);

    // Share with admin
    spreadsheet.addEditor(ADMIN_EMAIL);
  }

  return spreadsheet.getSheetByName('Submissions');
}

// ============================================================================
// HELPER: Send admin notification email
// ============================================================================
function sendAdminNotification(data) {
  const inquiryTypes = {
    'network': 'Enterprise Networking / ICT',
    'web': 'Web Development / Software',
    'surveillance': 'AI Surveillance / Security',
    'solar': 'Solar ICT / Power Solutions',
    'consultation': 'General Consultation',
    'partnership': 'Partnership / Collaboration'
  };

  const subject = `[${COMPANY_NAME}] New Inquiry: ${inquiryTypes[data.inquiry] || data.inquiry}`;

  const body = `
New contact form submission received:

-------------------------------------------
NAME: ${data.name}
EMAIL: ${data.email}
PHONE: ${data.phone || 'Not provided'}
INQUIRY TYPE: ${inquiryTypes[data.inquiry] || data.inquiry}
SOURCE: ${data.source || 'Direct'}
TIMESTAMP: ${new Date().toLocaleString()}
-------------------------------------------

MESSAGE:
${data.message}

-------------------------------------------
View all submissions: ${getOrCreateSheet().getParent().getUrl()}
  `;

  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: subject,
    body: body,
    name: COMPANY_NAME + ' Contact Form'
  });
}

// ============================================================================
// HELPER: Send auto-reply to submitter
// ============================================================================
function sendAutoReply(data) {
  const subject = `Thank you for contacting ${COMPANY_NAME}`;

  const body = `
Dear ${data.name},

Thank you for reaching out to ${COMPANY_NAME}. We have received your inquiry and our team will review it shortly.

Here's what happens next:
- Our engineers will review your requirements within 24 hours
- A team member will contact you via email or phone
- We'll schedule a consultation if needed

Your inquiry details:
- Type: ${data.inquiry}
- Submitted: ${new Date().toLocaleString()}

If your matter is urgent, please call us directly at +234 706 758 0599.

Best regards,
The ${COMPANY_NAME} Team

---
This is an automated response. Please do not reply to this email.
  `;

  MailApp.sendEmail({
    to: data.email,
    subject: subject,
    body: body,
    name: COMPANY_NAME
  });
}

// ============================================================================
// HELPER: JSON response with CORS headers
// ============================================================================
function jsonResponse(data, statusCode) {
  statusCode = statusCode || 200;
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
}

// ============================================================================
// SETUP FUNCTION - Run this once to initialize the spreadsheet
// ============================================================================
function setupSheet() {
  const sheet = getOrCreateSheet();
  Logger.log('Sheet created/updated: ' + sheet.getParent().getUrl());
  Logger.log('Sheet ID saved to script properties');
}

// ============================================================================
// TEST FUNCTION - Use this to test the email sending
// ============================================================================
function testEmail() {
  const testData = {
    name: 'Test User',
    email: 'test@example.com',
    phone: '+234 123 456 7890',
    inquiry: 'web',
    message: 'This is a test message from the Google Apps Script setup.',
    source: 'https://zionnetcomsolutionsltd.com.ng/contact.html'
  };

  sendAdminNotification(testData);
  sendAutoReply(testData);
  Logger.log('Test emails sent!');
}
