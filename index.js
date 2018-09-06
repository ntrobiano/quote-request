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
        options: [{ name: "Offer", values: [ "Consignment", "Upfront", "Store Credit" ] }],
        variants: [{ option1: "Consignment" }, { option1: "Upfront" }, { option1: "Store Credit" }],
        vendor,
        product_type: "Quote Request",
        tags: ("QuoteRequest, pfs:hidden"),
        published: true
    };

    // DONE: create a unpublished product

    request.post({
        auth,
        body: { product },
        json: true,
        url: `https://${SHOP_URL}/admin/products.json`
    }, (error, response, body) => {

        // DONE: create a draft order with above products
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

    // Get the current customers tags
    
    request.get({
        auth,
        url: `https://${SHOP_URL}/admin/customers/${customer_id}.json` 
    }, (error, response, body) => {
        if (body && body.tags) {
            tagsArray = body.tags.split(', ');
        }
        
        const tags = [ ...tagsArray, payment_method_tag, ordernumb ].join(', ');

        // Assign the payment method to the customer
        request.put({
            auth,
            json: true,
            body: { customer: { id: customer_id, tags, note: pp_email } },
            url: `https://${SHOP_URL}/admin/customers/${customer_id}.json` 
        });

        return res.sendStatus(200);
    });

});

app.listen(PORT);
