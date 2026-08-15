"use strict";
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TOKEN = process.env.LINKEDIN_TOKEN;
const AUTHOR = "urn:li:person:Hkk7VGE5ak";
const VERSION = "202607";

const POSTS_FILE = "posts.json";
const STATE_FILE = "last_published.json";

const posts = JSON.parse(fs.readFileSync(POSTS_FILE, "utf8"));

const today = new Date().toISOString().split("T")[0];

const post = posts.find(p => p.date === today);

if (!post) {
    console.log(`No post scheduled for ${today}`);
    process.exit(0);
}

// Idempotency check: read last_published.json
let lastPublished = null;
if (fs.existsSync(STATE_FILE)) {
    try {
        lastPublished = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch (err) {
        console.warn("Could not read state file, continuing:", err.message);
    }
}

if (lastPublished && lastPublished.date === today && lastPublished.id === post.id) {
    console.log(`Post id=${post.id} already published for ${today}, exiting.`);
    process.exit(0);
}

async function uploadImage(filePath) {
    console.log(`Uploading ${filePath}...`);

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

    const imageBuffer = fs.readFileSync(path.resolve(filePath));

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
                          images: imageUrns.map(imageUrn => ({ id: imageUrn }))
                      }
                  }
              }
            : {})
    };

    const response = await fetch("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
            "Linkedin-Version": VERSION
        },
        body: JSON.stringify(linkedinPost)
    });

    const responseText = await response.text();

    console.log("Post status:", response.status);
    console.log("Response:", responseText);

    if (!response.ok) {
        throw new Error("LinkedIn post creation failed");
    }

    console.log("POST PUBLISHED SUCCESSFULLY");

    // Persist state: record that this post was published
    const state = {
        id: post.id,
        date: today,
        publishedAt: new Date().toISOString(),
        response: (() => {
            try {
                return JSON.parse(responseText);
            } catch {
                return responseText;
            }
        })()
    };

    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
        console.log(`Wrote state to ${STATE_FILE}`);

        // Commit and push the state file so it persists for future runs.
        try {
            execSync('git config user.name "github-actions[bot]"');
            execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
            execSync(`git add ${STATE_FILE}`);
            try {
                execSync(`git commit -m "Record published post ${post.id} (${today})"`, { stdio: "inherit" });
            } catch (commitErr) {
                console.log("No changes to commit (or commit failed):", commitErr.message);
            }
            try {
                execSync("git push", { stdio: "inherit" });
            } catch (pushErr) {
                console.warn("git push failed (state file may not be persisted):", pushErr.message);
            }
        } catch (gitErr) {
            console.warn("Failed to commit state file:", gitErr.message);
        }
    } catch (fsErr) {
        console.warn("Failed to write or persist state file:", fsErr.message);
    }
}

publishPost().catch(error => {
    console.error("ERROR:", error.message);
    process.exit(1);
});
