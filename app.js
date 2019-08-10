'use strict';

const dialogflow = require('dialogflow');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
var mysql = require('mysql');
// const pg = require('pg');
const app = express();
const uuid = require('uuid');

var pool = mysql.createPool({
  connectionLimit : 100,
  host: config.PG_CONFIG.host,
  user: config.PG_CONFIG.user,
  password: config.PG_CONFIG.password,
  database: config.PG_CONFIG.database
});


// pg.defaults.ssl = true;

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
    throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
    throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.GOOGLE_PROJECT_ID) {
    throw new Error('missing GOOGLE_PROJECT_ID');
}
if (!config.DF_LANGUAGE_CODE) {
    throw new Error('missing DF_LANGUAGE_CODE');
}
if (!config.GOOGLE_CLIENT_EMAIL) {
    throw new Error('missing GOOGLE_CLIENT_EMAIL');
}
if (!config.GOOGLE_PRIVATE_KEY) {
    throw new Error('missing GOOGLE_PRIVATE_KEY');
}
if (!config.FB_APP_SECRET) {
    throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
    throw new Error('missing SERVER_URL');
}



app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
    verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
    extended: false
}));

// Process application/json
app.use(bodyParser.json());



const credentials = {
    client_email: config.GOOGLE_CLIENT_EMAIL,
    private_key: config.GOOGLE_PRIVATE_KEY,
};

const sessionClient = new dialogflow.SessionsClient(
    {
        projectId: config.GOOGLE_PROJECT_ID,
        credentials
    }
);


const sessionIds = new Map();

// Index route
app.get('/', function (req, res) {
    res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
    // console.log("I have reached here");
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
    console.log("I have reached here");
    var data = req.body;
    console.log(JSON.stringify(data));

    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function (pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function (messagingEvent) {
                if (messagingEvent.optin) {
                    receivedAuthentication(messagingEvent);
                } else if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else if (messagingEvent.delivery) {
                    receivedDeliveryConfirmation(messagingEvent);
                } else if (messagingEvent.postback) {
                    receivedPostback(messagingEvent);
                } else if (messagingEvent.read) {
                    receivedMessageRead(messagingEvent);
                } else if (messagingEvent.account_linking) {
                    receivedAccountLink(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        // You must send back a 200, within 20 seconds
        res.sendStatus(200);
    }
});





function receivedMessage(event) {

    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    console.log("Inside Received Message Satin");

    if (!sessionIds.has(senderID)) {
        sessionIds.set(senderID, uuid.v1());
    }
    //console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
    //console.log(JSON.stringify(message));

    var isEcho = message.is_echo;
    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;
    var quickReply = message.quick_reply;

    if (isEcho) {
        handleEcho(messageId, appId, metadata);
        return;
    } else if (quickReply) {
        handleQuickReply(senderID, quickReply, messageId);
        return;
    }


    if (messageText) {
        console.log("Inside Message Text Good Job Satin");
        //send message to api.ai
        sendToDialogFlow(senderID, messageText);
    } else if (messageAttachments) {
        handleMessageAttachments(messageAttachments, senderID);
    }
}


function handleMessageAttachments(messageAttachments, senderID){
    //for now just reply
    sendTextMessage(senderID, "Attachment received. Thank you.");
}

function handleQuickReply(senderID, quickReply, messageId) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
    //send payload to api.ai
    sendToDialogFlow(senderID, quickReplyPayload);
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}

function handleDialogFlowAction(sender, action, messages, contexts, parameters,textString) {
    switch (action) {

        case "job-enquiry":
    //     setTimeout(function() {
    //         let replies = [
    //           {
    //             content_type:"text",
    //             title:"Mumbai",
    //             payload:"MUMBAI",
    //             image_url:"https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Bombay_Stock_Exchange%2C_Mumbai.jpg/220px-Bombay_Stock_Exchange%2C_Mumbai.jpg"
    //           },
    //           {
    //             content_type:"text",
    //             title:"Pune",
    //             payload:"PUNE",
    //             image_url:"https://pimg.fabhotels.com/propertyimages/347/main/main-photos-fabhotel-blossoms-pune-airport-viman-nagar-pune-Hotels-20190507115153.jpg"
    //           },
    //           {
    //             content_type:"text",
    //             title:"Surat",
    //             payload:"SURAT",
    //             image_url:"https://img.etimg.com/thumb/height-480,width-640,msid-66992720,imgsize-79777/surat.jpg"
    //           },
    //           {
    //             content_type:"text",
    //             title:"Vadodara",
    //             payload:"VADODARA",
    //             image_url:"https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/NyayM.jpg/275px-NyayM.jpg"
    //           }
    //         ];

    //     sendQuickReply(sender, 'Hello! Thinking of buying your dream home? Let me help you with your search. Could you  please specify which city would suit you best MUMBAI, PUNE, SURAT, VADODARA?', replies)
    // },3000)
    

        getCity(displayCity);

        function displayCity(replies) {
            console.log('Outside database: ' + replies);
            console.log('Length outside database:'+ replies.length);
      
        console.log(replies)

        setTimeout(function() {
            
        sendQuickReply(sender, 'Hello! Thinking of buying your dream home? Let me help you with your search. Could you please specify which city would suit you?', replies)
    },3000)

}

    
        break;

        case "city-selected-mumbai":

        saveCity(sender,textString);

        getLocation(displayLocation);

        function displayLocation(replies) {

            console.log('Outside database: ' + replies);
            console.log('Length outside database:'+ replies.length);
      
        console.log(replies)

        setTimeout(function() {
            
        sendQuickReply(sender, 'In Mumbai we have an array of properties across different locations. Please select a location to proceed.', replies)
    },3000)

        }


            console.log('Result City: '+ textString);

             // saveCity(sender,textString);

            break;

        case "city-selected-pune":
        case "city-selected-surat":
        case "city-selected-vadodara":

            setTimeout(function(){

                let replies = [
              {
                content_type:"text",
                title:"Residential",
                payload:"RESIDENTIAL",
                // image_url:"http://www.propertiesatpune.com/wp-content/uploads/2015/02/one_nation_big.jpg"
              },
              {
                content_type:"text",
                title:"Commercial",
                payload:"COMMERCIAL",
                // image_url:"http://www.nanubhaiproperty.com/images/thumbs/property/439807_11000-sq-ft-agricultural-land-for-sale-garade-in-pune_800.jpeg"
              }
            ];

            sendQuickReply(sender, 'We have residential and commercial properties. Please help us with which property would interest you.', replies)
    },3000)

            console.log('Result City: '+ textString);
            saveCity(sender,textString);
            break;

        case 'location':

            setTimeout(function(){

                let replies = [
              {
                content_type:"text",
                title:"Residential",
                payload:"RESIDENTIAL",
                // image_url:"http://www.propertiesatpune.com/wp-content/uploads/2015/02/one_nation_big.jpg"
              },
              {
                content_type:"text",
                title:"Commercial",
                payload:"COMMERCIAL",
                // image_url:"http://www.nanubhaiproperty.com/images/thumbs/property/439807_11000-sq-ft-agricultural-land-for-sale-garade-in-pune_800.jpeg"
              }
            ];

            sendQuickReply(sender, 'We have residential and commercial properties. Please help us with which property would interest you.', replies)
    },3000)

            console.log('Result Location: '+ textString);

            saveLocation(sender,textString);

                break;

        case 'commercial':

            setTimeout(function(){
            sendTextMessage(sender, "Area of land in sq ft. (Eg 1000 sqft)")
        },3000)
            console.log(".............................AREA..........................");
            console.log('Result Configuration: '+ textString);  
            console.log(".............................AREA..........................");
            
            saveProperty(sender,1);

                break;

        case 'residential':

            setTimeout(function(){
                let replies = [
                  {
                    content_type:"text",
                    title:"1 RK",
                    payload:"1RK"
                  },
                  {
                    content_type:"text",
                    title:"1 BHK",
                    payload:"1BHK"
                    // image_url:"https://imgcld.yatra.com/ytimages/image/upload/t_seo_Hotel_w_930_h_550_c_fill_g_auto_q_40_f_jpg/v1420023135/Domestic%20Hotels/Hotels_Mumbai/ITC%20Grand%20Central/Overview.jpg"
                  },
                  {
                    content_type:"text",
                    title:"2 BHK",
                    payload:"2BHK"
                    // image_url:"https://imgs.nestimg.com/1bhk_apartment_altavista_phase_2_mumbai_110950951565335770.jpg"
                  },
                  {
                    content_type:"text",
                    title:"3 BHK",
                    payload:"3BHK"
                  },
                  {
                    content_type:"text",
                    title:"3 BHK+",
                    payload:"3BHK+"
                    
                  }
                ];

            sendQuickReply(sender, 'Great! Which configuration are you looking for?', replies)
    },3000)
            console.log('Result Specification: '+ textString);
            
            saveProperty(sender,0);

            break;

        case 'area':

            setTimeout(function(){
            sendTextMessage(sender, "Do you have any preferable budget in mind?")
        },3000)
            console.log(".............................AREA..........................");
            console.log('Result AREA: '+ textString);
            console.log(".............................AREA..........................");
            saveArea(sender,textString);
            break;



        case 'configuration': 

            setTimeout(function(){
            sendTextMessage(sender, "Any preferable budget in mind?");
        },3000);

            console.log('Result Configuration: '+ textString);
console.log(".................................CONFIGURATION......................................");

            saveSpecification(sender,textString);
            break;

        case "budget":

        saveBudget(sender,textString);
        console.log(".................................BUDGET......................................");
        console.log("parameters: "+ textString);
        // console.log(".................................BUDGET......................................");
        // console.log("contexts" +JSON.stringify(contexts));



            setTimeout(function(){
            sendTextMessage(sender, "We would like to get in touch with you. Please enter your full name.")
        },3000)
            break;

        case "name":
        
            sendTextMessage(sender, "And your Contact Number?");
            console.log('Result Name: '+ textString);

            saveName(sender,textString);
            break;

        case "contact":

        saveContact(sender,textString);

        setTimeout(function(){
            sendTextMessage(sender, "Thank You for your valueable time. One of our property consultants will get in touch with you.")
        },3000)


        getProperty(sender,displayProperty);

        function displayProperty(replies) {

        console.log('Outside database: ' + replies);
        console.log('Length outside database:'+ replies.length);
        console.log(replies);

        setTimeout(function() {  
        sendButtonMessage(sender,"Meanwhile you can explore our website.",replies);
          },3000)

        }

            console.log("............................CONTACT..........................");
            console.log('Result Contact: '+ textString);
        

            break;

        default:
            //unhandled action, just send back the text
            handleMessages(messages, sender);
    }
}

function handleMessage(message, sender) {
    switch (message.message) {
        case "text": //text
            message.text.text.forEach((text) => {
                if (text !== '') {
                    sendTextMessage(sender, text);
                }
            });
            break;
        case "quickReplies": //quick replies
            let replies = [];
            message.quickReplies.quickReplies.forEach((text) => {
                let reply =
                    {
                        "content_type": "text",
                        "title": text,
                        "payload": text
                    }
                replies.push(reply);
            });
            sendQuickReply(sender, message.quickReplies.title, replies);
            break;
        case "image": //image
            sendImageMessage(sender, message.image.imageUri);
            break;
    }
}


function handleCardMessages(messages, sender) {

    let elements = [];
    for (var m = 0; m < messages.length; m++) {
        let message = messages[m];
        let buttons = [];
        for (var b = 0; b < message.card.buttons.length; b++) {
            let isLink = (message.card.buttons[b].postback.substring(0, 4) === 'http');
            let button;
            if (isLink) {
                button = {
                    "type": "web_url",
                    "title": message.card.buttons[b].text,
                    "url": message.card.buttons[b].postback
                }
            } else {
                button = {
                    "type": "postback",
                    "title": message.card.buttons[b].text,
                    "payload": message.card.buttons[b].postback
                }
            }
            buttons.push(button);
        }


        let element = {
            "title": message.card.title,
            "image_url":message.card.imageUri,
            "subtitle": message.card.subtitle,
            "buttons": buttons
        };
        elements.push(element);
    }
    sendGenericMessage(sender, elements);
}


function handleMessages(messages, sender) {
    let timeoutInterval = 1100;
    let previousType;
    let cardTypes = [];
    let timeout = 0;
    for (var i = 0; i < messages.length; i++) {

        if ( previousType == "card" && (messages[i].message != "card" || i == messages.length - 1)) {
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
            timeout = i * timeoutInterval;
            setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
        } else if ( messages[i].message == "card" && i == messages.length - 1) {
            cardTypes.push(messages[i]);
            timeout = (i - 1) * timeoutInterval;
            setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
            cardTypes = [];
        } else if ( messages[i].message == "card") {
            cardTypes.push(messages[i]);
        } else  {

            timeout = i * timeoutInterval;
            setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
        }

        previousType = messages[i].message;

    }
}

function handleDialogFlowResponse(sender, response,textString) {

    let responseText = response.fulfillmentMessages.fulfillmentText;
    let messages = response.fulfillmentMessages;
    let action = response.action;
    let contexts = response.outputContexts;
    let parameters = response.parameters;

    // console.log(".................................................");
    // console.log("RESPONSE TEXT: "+JSON.stringify(response));
    // console.log("................................................");
    // console.log("Response TEXT........: "+responseText);

    sendTypingOff(sender);

    if (isDefined(action)) {
        handleDialogFlowAction(sender, action, messages, contexts, parameters,textString);
    } else if (isDefined(messages)) {
        handleMessages(messages, sender);
    } else if (responseText == '' && !isDefined(action)) {
        //dialogflow could not evaluate input.
        sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
    } else if (isDefined(responseText)) {
        sendTextMessage(sender, responseText);
    }
}

async function sendToDialogFlow(sender, textString, params) {

    sendTypingOn(sender);

    try {
        const sessionPath = sessionClient.sessionPath(
            config.GOOGLE_PROJECT_ID,
            sessionIds.get(sender)
        );

        const request = {
            session: sessionPath,
            queryInput: {
                text: {
                    text: textString,
                    languageCode: 'en-US'
                },
            },
            queryParams: {
                payload: {
                    data: params
                }
            }
        };


        const responses = await sessionClient.detectIntent(request);

        const result = responses[0].queryResult;
        // console.log(JSON.stringify(result));
        handleDialogFlowResponse(sender, result,textString);
    } catch (e) {
        console.log('error'+e);
    }

}




function sendTextMessage(recipientId, text) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text
        }
    }
    callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: imageUrl
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: config.SERVER_URL + "/assets/instagram_logo.gif"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "audio",
                payload: {
                    url: config.SERVER_URL + "/assets/sample.mp3"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "video",
                payload: {
                    url: config.SERVER_URL + videoName
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "file",
                payload: {
                    url: config.SERVER_URL + fileName
                }
            }
        }
    };

    callSendAPI(messageData);
}



/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: text,
                    buttons: buttons
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: elements
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
                            timestamp, elements, address, summary, adjustments) {
    // Generate a random receipt ID as the API requires a unique ID
    var receiptId = "order" + Math.floor(Math.random() * 1000);

    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "receipt",
                    recipient_name: recipient_name,
                    order_number: receiptId,
                    currency: currency,
                    payment_method: payment_method,
                    timestamp: timestamp,
                    elements: elements,
                    address: address,
                    summary: summary,
                    adjustments: adjustments
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text,
            metadata: isDefined(metadata)?metadata:'',
            quick_replies: replies
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {

    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "mark_seen"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_on"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_off"
    };

    callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Welcome. Link your account.",
                    buttons: [{
                        type: "account_link",
                        url: config.SERVER_URL + "/authorize"
                    }]
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
    request({
        uri: 'https://graph.facebook.com/v3.2/me/messages',
        qs: {
            access_token: config.FB_PAGE_TOKEN
        },
        method: 'POST',
        json: messageData

    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;

            if (messageId) {
                console.log("Successfully sent message with id %s to recipient %s",
                    messageId, recipientId);
            } else {
                console.log("Successfully called Send API for recipient %s",
                    recipientId);
            }
        } else {
            console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
        }
    });
}



/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    // The 'payload' param is a developer-defined field which is set in a postback
    // button for Structured Messages.
    var payload = event.postback.payload;

    switch (payload) {

        case 'GET_STARTED':

        sendToDialogFlow(senderID,"hi");
        
        default:
            // unindentified payload
            sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
            break;

    }

    console.log("Received postback for user %d and page %d with payload '%s' " +
        "at %d", senderID, recipientID, payload, timeOfPostback);

}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    console.log("I got Here");

    // All messages before watermark (a timestamp) or sequence have been seen.
    var watermark = event.read.watermark;
    var sequenceNumber = event.read.seq;

    console.log("Received message read event for watermark %d and sequence " +
        "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 * 
 */
function receivedAccountLink(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    var status = event.account_linking.status;
    var authCode = event.account_linking.authorization_code;

    console.log("Received account link event with for user %d with status %s " +
        "and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var delivery = event.delivery;
    var messageIDs = delivery.mids;
    var watermark = delivery.watermark;
    var sequenceNumber = delivery.seq;

    if (messageIDs) {
        messageIDs.forEach(function (messageID) {
            console.log("Received delivery confirmation for message ID: %s",
                messageID);
        });
    }

    console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfAuth = event.timestamp;

    // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
    // The developer can set this to an arbitrary value to associate the
    // authentication callback with the 'Send to Messenger' click event. This is
    // a way to do account linking when the user clicks the 'Send to Messenger'
    // plugin.
    var passThroughParam = event.optin.ref;

    console.log("Received authentication for user %d and page %d with pass " +
        "through param '%s' at %d", senderID, recipientID, passThroughParam,
        timeOfAuth);

    // When an authentication is received, we'll send a message back to the sender
    // to let them know it was successful.
    sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.

 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 */
function verifyRequestSignature(req, res, buf) {
    var signature = req.headers["x-hub-signature"];

    if (!signature) {
        throw new Error('Couldn\'t validate the signature.');
    } else {
        var elements = signature.split('=');
        var method = elements[0];
        var signatureHash = elements[1];

        var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
            .update(buf)
            .digest('hex');

        if (signatureHash != expectedHash) {
            throw new Error("Couldn't validate the request signature.");
        }
    }
}

function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

// function saveUser(userId) {

//                     con.connect(function(err) {
//                         if (err) throw err;
//                         var rows = [];
//                         const sql = `SELECT * FROM users where fbId = '${userId}' LIMIT 1`;
//                         con.query(sql, function(err,result) {
//                             if (err) throw err;
//                             console.log(console.log(result));
//                         })
//                     })
//                 }



function getCity(callback) {
    let sql = "Select `cityName` from `city`";
    
    var replies = [];
    pool.query(sql,function(err,result) {
        if (err) throw err;
    
        let length = Object.keys(result).length;
        // console.log(length);
        for (var i = 0; i < length; i++) 
        {
            // console.log('HERE: '+result[i].cityName);
            // console.log('HERE: '+result[i].imgUrl);
            let obj = {
                content_type:"text",
                title: result[i].cityName,
                payload: result[i].cityName,
              };
        replies.push(obj);
        }
        // console.log("Inside: "+l);
        callback(replies);
        })

 }

 function getLocation(callback) {
    let sql = "SELECT `location` FROM `location` WHERE `cityId` IN ( SELECT `cityId` from `city` WHERE `cityName` IN (SELECT `cityName` from `users`))"

    var replies = [];
    pool.query(sql,function(err,result) {
        if (err) throw err;
    
        let length = Object.keys(result).length;
        // console.log(length);
    

        for (var i = 0; i < length; i++) 
        {
            let obj = {
                content_type:"text",
                title: result[i].location,
                payload: result[i].location,
                };
            replies.push(obj);
        }
        console.log("................................Got location from database..................................")
            callback(replies);
        
        })
 }

 function getProperty(userId,callback) {
    let sql = "SELECT `property`,`propertyName` FROM `property` WHERE `locationId` IN ( SELECT `locId` from `location` WHERE `location` in ( SELECT `location` from `users` where `fbId`='"+userId+"')) AND `flag` IN ( SELECT `property` FROM `users` where `fbId`='"+userId+"')"
    var replies = [];
    pool.query(sql,function(err,result) {
        if (err) throw err;
    
        let length = Object.keys(result).length;
        if (length>0) {
            for (var i = 0; i < length; i++) 
            {
                let obj = {
                    type:"web_url",
                    url: result[i].property,
                    title: result[i].propertyName,
                    };
                replies.push(obj);
            }
                callback(replies);
        }
        else {
            let obj = {
                    type:"web_url",
                    url:"https://sai-estate.com",
                    title:"SAI Estate",
                    };
                replies.push(obj);
                callback(replies);
        }
    })

}

function saveCity(userID,city) {
                    
        var sql = "INSERT INTO `users` (`fbId`, `city`) VALUES ('"+userID+"', '"+city+"')";
        pool.query(sql, function (err, result) {
            if (err) throw err;
            console.log("1 record inserted");
        });
}

function saveLocation(userID,location) {

        var sql = "UPDATE `users` SET `location` = '"+location+"' WHERE `fbId` = '"+userID+"'";
        pool.query(sql, function (err, result) {
            if (err) throw err;
            console.log("1 record inserted");
        });
}

function saveProperty(userID,property) {
    
        var sql = "UPDATE `users` SET `property` = '"+property+"' WHERE `fbId` = '"+userID+"'";
        pool.query(sql, function (err, result) {
            if (err) throw err;
            console.log("1 record inserted");
            // console.log(result);
        });

}

// function saveProperty(userID,property) {
    
//         var sql = "UPDATE `users` SET `property` = '"+property+"' WHERE `fbId` = '"+userID+"'";
//         pool.query(sql, function (err, result) {
//             if (err) throw err;
//             console.log("1 record inserted");
//             // console.log(result);
//         });
// }

function saveArea(userID,area) {
    
        var sql = "UPDATE `users` SET `area` = '"+area+"' WHERE `fbId` = '"+userID+"'";
        pool.query(sql, function (err, result) {
            if (err) throw err;
            console.log("1 record inserted");
            // console.log(result);
        });
}

function saveSpecification(userID,specification) {
    
        var sql = "UPDATE `users` SET `specification` = '"+specification+"' WHERE `fbId` = '"+userID+"'";
        pool.query(sql, function (err, result) {
            if (err) throw err;
            console.log("1 record inserted");
            // console.log(result);
        });
    
    
}
function saveBudget(userID,budget) {

        var sql = "UPDATE `users` SET `budget` = '"+budget+"' WHERE `fbId` = '"+userID+"'";
        pool.query(sql, function (err, result) {
            if (err) throw err;
            console.log("1 record inserted");
        });
}

function saveName(userID,name) {
 
        var sql = "UPDATE `users` SET `name` = '"+name+"' WHERE `fbId` = '"+userID+"'";
        pool.query(sql, function (err, result) {
            if (err) throw err;
            console.log("1 record inserted");
    });
}

function saveContact(userID,contact) {

        var sql = "UPDATE `users` SET `contact` = '"+contact+"' WHERE `fbId` = '"+userID+"'";
        pool.query(sql, function (err, result) {
            if (err) throw err;
            console.log("1 record inserted");
        });


//         pool.end(function (err) {
//   // all connections in the pool have ended
//         console.log("Connection Ended..................................");
// })

}

// SELECT `property` FROM `property` WHERE `locationId` IN ( SELECT `locId` from location WHERE `location` in ( SELECT `location` from `users`)) AND `flag` IN ( SELECT `property` FROM `users`)

pool.on('error', function(err) {
  console.log("[mysql error]",err);
});

// Spin up the server
app.listen(app.get('port'), function () {
    console.log('running on port', app.get('port'))
})
