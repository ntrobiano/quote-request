const express = require('express');
const request = require('request');
require('dotenv').config();

const app = express();
const { PORT, SHOP_URL, SHOPIFY_API_KEY, SHOPIFY_PASSWORD } = process.env;
const auth = { user: SHOPIFY_API_KEY, password: SHOPIFY_PASSWORD };

app.use(express.json());

app.get('/', (req, res) => res.send('Shopify Quote Request'));

app.post('/quote', (req, res) => {
    const {
        customer_id,
        product_type,
        vendor,
        body_html,
        condition,
        year_purchased,
        original_price,
    } = req.body;

    console.log(req.body);

    // DONE: create combined body with html + condition, year_purchased, original_price

    const product = {
        title: `New Quote: ${new Date().getTime()}`,
        body_html: `
            ${body_html}
            Condition: ${condition}\n
            Year Purchased: ${year_purchased}\n
            Original Price: ${original_price}
        `,
        options: [{ name: "Offer", values: [ "Consignment", "Upfront", "Store Credit" ] }],
        variants: [{ option1: "Consignment" }, { option1: "Upfront" }, { option1: "Store Credit" }],
        vendor,
        product_type,
        tags: "QuoteRequest",
        published: false
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
            console.log(product.options, product.variants, product.tags)
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

app.listen(PORT);
