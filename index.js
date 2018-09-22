require('dotenv').config();
const express = require('express');
const request = require('request');
const cors = require('cors');
const multer = require('multer');
var maxSize = 5 * 1000 * 1000 * 1000;
const app = express();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSize } });
const { PORT, SHOP_URL, SHOPIFY_API_KEY, SHOPIFY_PASSWORD } = process.env;
const auth = { user: SHOPIFY_API_KEY, password: SHOPIFY_PASSWORD };

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('Shopify Quote Request'));

app.post('/quote', upload.array('photos', 4), (req, res) => {
    const {
        customer_id,
        vendor,
        body_html,
        type,
        condition,
        dimensions,
        year_purchased,
        original_price,
    } = req.body;

    console.log(req.body, req.files);

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
        images: req.files.map(file => file.buffer && ({ attachment: file.buffer.toString("base64") })),
        options: [{ name: "Offer", values: [ "Consignment", "Upfront Purchase", "Store Credit" ] }],
        variants: [
            {   inventory_management: "shopify",
                inventory_quantity: 0,
                option1: "Consignment" }, 
                
            {   inventory_management: "shopify",
                inventory_quantity: 0,
                option1: "Upfront Purchase" }, 
                
            {   inventory_management: "shopify",
                inventory_quantity: 0,
                option1: "Store Credit" }],
        vendor,
        product_type: "QuoteRequest",
        tags: ("QuoteRequest", "pfs:hidden"),
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
            // console.log(product.options, product.variants, product.tags)
            request.post({
                auth,
                body: {
                  draft_order: {
                    customer: {
                        id:customer_id,
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
        unwanted_variant_ids, // consignment, up_front, store_credit
        payment_method_tag, // check, paypal, transfer, international
        pp_email,
        bt_name, bt_address, bt_accounttype, bt_bankname, bt_bankaddress, bt_accountnumber, bt_routingnumber,
        bi_name, bi_address, bi_accounttype, bi_bankname, bi_bankaddress, bi_iban, bi_swift,
    } = req.body;

    console.log(req.body);

    // Delete the vartiants we don't want
    unwanted_variant_ids.forEach(variant_id => {
        request.delete({
            auth,
            url: `https://${SHOP_URL}/admin/products/${product_id}/variants/${variant_id}.json` 
        });
    });

    let tagsArray = [];
    let existingordernumb = []

    // Get the current customers tags
    
    request.get({
        auth,
        url: `https://${SHOP_URL}/admin/customers/${customer_id}.json` 
    }, (error, response, body) => {
        if (body && body.tags) {
            tagsArray = body.tags.split(', ');
            existingordernumb = ordernumb;
        }
        
        const tags = [ ...tagsArray, existingordernumb, payment_method_tag, ordernumb ].join(', ');
        
        // Assign the payment method to the customer
        request.put({
            auth,
            json: true,
            body: { 
                customer: { 
                    id: customer_id, 
                    tags, 
                    note: `
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

app.listen(PORT);
