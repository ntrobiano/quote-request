require('dotenv').config();
const express = require('express');
const request = require('request');
const cors = require('cors');
const multer = require('multer');
const sgMail = require('@sendgrid/mail');
const Sentry = require('@sentry/node');
const Shippo = require('shippo');

const GIGABITE = 1000 * 1000 * 1000;

const app = express();

const {
    PORT,
    SENDGRID_API_KEY,
    SENTRY_DSN,
    SHOP_URL,
    SHOPIFY_API_KEY,
    SHOPIFY_PASSWORD,
    UPS_PASSWORD,
    SHIPPO_API_KEY
} = process.env;
const auth = { user: SHOPIFY_API_KEY, password: SHOPIFY_PASSWORD };

Sentry.init({ dsn: SENTRY_DSN });

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
app.use(cors());
app.use(express.json());

sgMail.setApiKey(SENDGRID_API_KEY);
const shippo = Shippo(SHIPPO_API_KEY);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * GIGABITE }
});

app.get('/', (req, res) => res.send('Shopify Quote Request'));

app.post('/quote', upload.array('photos', 4), (req, res) => {
    const {
        customer_id,
        customer_email,
        customer_fn,
        vendor,
        body_html,
        type,
        condition,
        dimensions,
        year_purchased,
        original_price,
    } = req.body;

    // Extra info for sentry.io in the event that an error is thrown later
    // Sentry.configureScope(scope => {
    //     scope.setTag(req.body);
    // });

    // DONE: create combined body with html + condition, year_purchased, original_price, dimensions

    const product = {
        title: `New Quote: ${new Date().toDateString()}`,
        body_html: `
            ${body_html}
            Product Type: ${type}\n
            Condition: ${condition}\n
            Dimensions: ${dimensions}\n
            Year Purchased: ${year_purchased}\n
            Original Price: ${original_price}
        `,
        images: (req.files || []).map(file => file.buffer && ({ attachment: file.buffer.toString("base64") })),
        options: [{ name: "Offer", values: ["Consignment", "Upfront Purchase", "Store Credit"] }],
        variants: [
            {
                inventory_management: "shopify",
                inventory_quantity: 0,
                option1: "Consignment" 
            },

            {
                inventory_management: "shopify",
                inventory_quantity: 0,
                option1: "Upfront Purchase"
            },

            {
                inventory_management: "shopify",
                inventory_quantity: 0,
                option1: "Store Credit"
            }],
        vendor,
        product_type: "QuoteRequest",
        tags: `QuoteRequest, pfs:hidden`,
        published: true
    };

    // DONE: create a unpublished product
    request.post({
        auth,
        body: { product },
        json: true,
        url: `https://${SHOP_URL}/admin/products.json`
    }, (error, response, body) => {

        // DONE: create a draft order using above products
        if (body) {
            const { product } = body;
            
            request.post({
                auth,
                body: {
                    draft_order: {
                        customer: {
                            id: customer_id,
                        },
                        use_customer_default_address: true,
                        line_items: product.variants.map(variant => ({
                            variant_id: variant.id,
                            quantity: 1
                        })),
                        tags: "pending"
                    }
                },
                json: true,
                url: `https://${SHOP_URL}/admin/draft_orders.json`
            });
            
            sgMail.send({
                to: customer_email,
                from: 'service@coutureusa.com',
                subject: 'Your Quote Has Been Submitted',
                html: `
                    Dear ${customer_fn},<br><br>
                    Thank you for contacting CoutureUSA. We have successfully received your quote request information.<br>
                    You will receive a follow-up email with pricing details following the review by one of our qualified experts.<br>
                    Please note, quotes are completed in the order they are received.<br>
                    Please allow 1-2 business days to receive a response.<br><br>
                    Brand: <strong>${vendor}</strong>,<br>
                    Item Type: <strong>${type}</strong>,<br><br>
                    In the mean time, please contact us if you have any questions or if we can assist you in any other way.<br>
                    Thank you again and enjoy your day!<br><br>
                    <strong>QUOTE TEAM</strong><br>
                    Couture Designer Resale Boutique<br>
                    888.969.7455 - Toll Free<br>
                    813.926.9889 - Local<br>
                    888.969.7455 - Fax<br>
                    <a href="https://coutureusa.com"><strong>www.coutureusa.com</strong></a>
                `,
            });

            res.send('New Quote Created');

        };

    });

});
 
// DONE: Created quote
app.post('/quote-approval', (req, res) => {
    const {
        customer_id,
        product_id,
        ordernumb,
        markdown,
        unwanted_variant_ids, // consignment, up_front, store_credit
        payment_method_tag, // check, paypal, transfer, international
        pp_email,
        bt_name, bt_address, bt_accounttype, bt_bankname, bt_bankaddress, bt_accountnumber, bt_routingnumber,
        bi_name, bi_address, bi_accounttype, bi_bankname, bi_bankaddress, bi_iban, bi_swift,
    } = req.body;

    // Extra info for sentry.io in the event that an error is thrown later
    //Sentry.configureScope(scope => {
    //    scope.setTag(req.body);
    //});

    // Delete the vartiants we don't want
    unwanted_variant_ids.forEach(variant_id => {
        request.delete({
            auth,
            url: `https://${SHOP_URL}/admin/products/${product_id}/variants/${variant_id}.json` 
        });
    });

    // Assign product markdown tag to product 

    request.put({
        auth,
        json: true,
        body: { 
            product: {
                id: product_id,
                tags: `${markdown}, QuoteRequest, pfs:hidden`
            }
        },
        url: `https://${SHOP_URL}/admin/products/${product_id}.json`
    });

    let tagsArray = [];

    // Get the current customers tags
    
    request.get({
        auth,
        url: `https://${SHOP_URL}/admin/customers/${customer_id}.json` 
    }, (error, response, body) => {
        if (body && body.tags) {
            tagsArray = body.tags.split(', ');
            ordernumb;
        }
        
        const tags = [ ...tagsArray, payment_method_tag, ordernumb].join(', ');
        
        // Assign the payment method to the customer
        request.put({
            auth,
            json: true,
            body: { 
                customer: { 
                    id: customer_id, 
                    tags, 
                    note:`
                    PayPal Email:${pp_email}\n
                    BANK TRANSFER
                    Customer Name: ${bt_name}
                    Customer Address: ${bt_address}
                    Account Type: ${bt_accounttype}
                    Bank Name: ${bt_bankname}
                    Bank Address: ${bt_bankaddress}
                    Account Number: ${bt_accountnumber}
                    Routing Number: ${bt_routingnumber}\n
                    INTERNATIONAL BANK
                    Customer Name: ${bi_name}
                    Customer Address: ${bi_address}
                    Account Type: ${bi_accounttype}
                    Bank Name: ${bi_bankname}
                    Bank Address: ${bi_bankaddress}
                    Account Number: ${bi_iban}
                    Routing Number: ${bi_swift}
                `  
                }
            },
            url: `https://${SHOP_URL}/admin/customers/${customer_id}.json` 
        });

        return res.sendStatus(200);
    });

});


app.post('/shipping-label', (req, res) => {
    const {
        customer_name,
        customer_company,
        customer_street1,
        customer_street2,
        customer_city,
        customer_state,
        customer_zip,
        customer_country,
        customer_phone,
        customer_email,
        product_id_update,
    } = req.body;

    // Extra info for sentry.io in the event that an error is thrown later
    //Sentry.configureScope(scope => {
    //    scope.setTag(req.body);
    //});

    var addressFrom  = {
        name: customer_name,
        company: customer_company,
        street1: customer_street1,
        street2: customer_street2,
        city: customer_city,
        state: customer_state,
        zip: customer_zip,
        country: customer_country, //iso2 country code
        phone: customer_phone,
        email: customer_email
    }
    
    // example address_to object dict
    var addressTo = {
        name: "Merchandise Review Department",
        company: "Couture USA",
        street1: "10117 Montague St.",
        city: "Tampa",
        state: "FL",
        zip: "33626",
        country: "USA", //iso2 country code
        phone: "1-888-969-7455",
        email: "service@coutureusa.com"
    }
    
    // parcel object dict
    var parcel = {
        length: "18",
        width: "12",
        height: "8",
        distance_unit: "in",
        weight: "3",
        mass_unit: "lb"
    }

    shippo.shipment.create({
                "address_from": addressFrom,
                "address_to": addressTo,
                "parcels": [parcel],
                "async": false
    })
    .then(shipment => {
        console.log("shipment : %s", JSON.stringify(shipment, null, 4));
        return shippo.shipment.rates(shipment.object_id)
    })
    .then(rates => {
        // get the first rate ( NOT SURE IF THIS IS WHAT WE WANT )
        rate = rates.results[0];
        // Purchase the desired rate
        return shippo.transaction.create({ "rate": rate.object_id, "async": false})
    })
    .then(transaction => {
        console.log("transaction : %s", JSON.stringify(transaction, null, 4));
        // print label_url and tracking_number
        if (transaction.status == "SUCCESS") {            
            console.log("Label URL: %s", transaction.label_url);
            console.log("Tracking Number: %s", transaction.tracking_number);

            sgMail.send({
                to: customer_email,
                from: 'service@coutureusa.com',
                subject: 'Couture USA – Prepaid Shipping Label',
                html: `
                    Your UPS prepaid shipping label is ready for you to download.<br>
                    Please click the link below to download it, then print the label and send in your package.<br>
                    Our Buying Team will contact you once your package is received and reviewed.<br>
                    <a href="${transaction.label_url}"><strong>Download Shipping Label</strong></a><br><br>
                    Thank you,<br>
                    <strong>QUOTE TEAM</strong><br>
                    Couture Designer Resale Boutique<br>
                    888.969.7455 - Toll Free<br>
                    813.926.9889 - Local<br>
                    888.969.7455 - Fax<br>
                    <a href="https://coutureusa.com"><strong>www.coutureusa.com</strong></a>    
                `,
            });

            request.put({
                auth,
                json: true,
                body: { 
                    product: {
                        id: product_id_update,
                        tags: `${markdown}, LabelRequested, QuoteRequest, pfs:hidden`
                    }
                },
                url: `https://${SHOP_URL}/admin/products/${product_id_update}.json`
            });

        } else {
            //Deal with an error with the transaction
            console.log("Message: %s", JSON.stringify(transaction.messages, null, 2));
            
            sgMail.send({
                to: customer_email,
                from: 'service@coutureusa.com',
                subject: 'Couture USA – We need some more information for your label',
                html: `
                    We're sorry, but we need some more information before we create your prepaid shipping label.<br>
                    Please check your account to ensure your primary address is accurate, or contact our team for assistance.<br>
                    <a href="https://coutureusa.com/account"><strong>Check my account</strong></a><br><br>                
                    Thank you,<br>
                    <strong>QUOTE TEAM</strong><br>
                    Couture Designer Resale Boutique<br>
                    888.969.7455 - Toll Free<br>
                    813.926.9889 - Local<br> 
                    888.969.7455 - Fax<br>
                    <a href="https://coutureusa.com"><strong>www.coutureusa.com</strong></a>
                `,
            });


        }

    })
    .then(() => res.sendStatus(200))
    .catch(error => res.send(error));

});


app.listen(PORT);