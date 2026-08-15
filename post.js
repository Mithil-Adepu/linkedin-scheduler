require("dotenv").config();

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.LINKEDIN_TOKEN;
const AUTHOR = "urn:li:person:Hkk7VGE5ak";
const VERSION = "202607";

const posts = JSON.parse(
    fs.readFileSync("posts.json", "utf8")
);

const today = new Date().toISOString().split("T")[0];

const post = posts.find(p => p.date === today);

if (!post) {
    console.log(`No post scheduled for ${today}`);
    process.exit(0);
}

async function uploadImage(filePath) {
    console.log(`Uploading ${filePath}...`);

    // 1. Initialize image upload
    const initResponse = await fetch(
        "https://api.linkedin.com/rest/images?action=initializeUpload",
        {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${TOKEN}`,
                "Content-Type": "application/json",
                "Linkedin-Version": VERSION,
                "X-Restli-Protocol-Version": "2.0.0"
            },
            body: JSON.stringify({
                initializeUploadRequest: {
                    owner: AUTHOR
                }
            })
        }
    );

    const initText = await initResponse.text();

    if (!initResponse.ok) {
        throw new Error(
            `Image initialization failed: ${initResponse.status} ${initText}`
        );
    }

    const initData = JSON.parse(initText);

    const uploadUrl = initData.value.uploadUrl;
    const imageUrn = initData.value.image;

    // 2. Read local image
    const imageBuffer = fs.readFileSync(
        path.resolve(filePath)
    );

    // 3. Upload actual image
    const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
            "Content-Type": "image/png"
        },
        body: imageBuffer
    });

    if (!uploadResponse.ok) {
        throw new Error(
            `Image upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`
        );
    }

    console.log(`Uploaded successfully → ${imageUrn}`);

    return imageUrn;
}

async function publishPost() {
    const postImages = Array.isArray(post.images) ? post.images : [];
    const imageUrns = [];

    for (const image of postImages) {
        const imageUrn = await uploadImage(image);
        imageUrns.push(imageUrn);
    }

    console.log("Creating LinkedIn post...");

    const linkedinPost = {
        author: AUTHOR,

        commentary: post.text,

        visibility: "PUBLIC",

        distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: []
        },

        lifecycleState: "PUBLISHED",

        isReshareDisabledByAuthor: false,

        ...(imageUrns.length > 0
            ? {
                content: {
                    multiImage: {
                        images: imageUrns.map(imageUrn => ({
                            id: imageUrn
                        }))
                    }
                }
            }
            : {})
    };

    const response = await fetch(
        "https://api.linkedin.com/rest/posts",
        {
            method: "POST",

            headers: {
                "Authorization": `Bearer ${TOKEN}`,
                "Content-Type": "application/json",
                "X-Restli-Protocol-Version": "2.0.0",
                "Linkedin-Version": VERSION
            },

            body: JSON.stringify(linkedinPost)
        }
    );

    const responseText = await response.text();

    console.log("Post status:", response.status);
    console.log("Response:", responseText);

    if (!response.ok) {
        throw new Error("LinkedIn post creation failed");
    }

    console.log("POST PUBLISHED SUCCESSFULLY");
}

publishPost().catch(error => {
    console.error("ERROR:", error.message);
    process.exit(1);
});