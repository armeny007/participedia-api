"use strict";
let express = require("express");
let router = express.Router(); // eslint-disable-line new-cap
let cache = require("apicache");
let log = require("winston");
let { db, as, USER_BY_ID, UPDATE_USER } = require("../helpers/db");

async function getStaticText(language) {
  // merge localized text from the db with the keys that need to be added.
  return await db.one(
    `select * from layout_localized where language = '${language}';`
  );
}

async function getUserById(userId, req, res, view="view") {
  try {
    const language = req.params.language || "en";

    const result = await db.oneOrNone(USER_BY_ID, {
      userId: userId,
      language: language,
    });
    if (!result) {
      return res
        .status(404)
        .json({ OK: false, error: `User not found for user_id ${userId}` });
    }

    const staticText = await getStaticText(language);

    if (view === "edit") {
      // only return some keys on the user object for the edit view
      const userEditKeys = [
        "id",
        "hidden",
        "name",
        "email",
        "location",
        "language",
        "login",
        "picture_url",
        "bio",
        "isadmin",
        "join_date"
      ];
      const userEditJSON = {};
      userEditKeys.forEach(key => userEditJSON[key] = result.user[key]);

      return {
        static: staticText,
        user: userEditJSON,
      };
    } else {
      return {
        static: staticText,
        user: result.user,
      };
    }
  } catch (error) {
    log.error("Exception in GET /user/%s => %s", userId, error);
    console.trace(error);
    if (error.message && error.message == "No data returned from the query.") {
      res.status(404).json({ OK: false });
    } else {
      res.status(500).json({ OK: false, error: error });
    }
  }
}

/**
 * @api {get} /user/:userId Retrieve a user
 * @apiGroup users
 * @apiVersion 0.1.0
 * @apiName getUserById
 * @apiParam {Number} userId user ID
 *
 * @apiSuccess {Boolean} OK true if call was successful
 * @apiSuccess {data} User object if call was successful
 * @apiSuccess {String[]} errors List of error strings (when `OK` is false)
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        OK: true
 *     }
 *
 * @apiError NotAuthenticated The user is not authenticated
 * @apiError NotAuthorized The user doesn't have permission to perform this operation.
 *
 */
router.get("/:userId", async function(req, res) {
  try {
    const data = await getUserById(req.params.userId || req.user.user_id, req, res, "view");

    // return html template
    res.status(200).render(`user-view`, data);
  } catch (error) {
    console.error("Problem in /user/:userId");
    console.trace(error);
  }
});

router.get("/:userId/edit", async function(req, res) {
  try {
    const data = await getUserById(req.params.userId || req.user.user_id, req, res, "edit");

    // return html template
    res.status(200).render(`user-edit`, data);
  } catch (error) {
    console.error("Problem in /user/:userId/edit");
    console.trace(error);
  }
});

router.get("/", async function(req, res) {
  try {
    if (!req.user) {
      return res.status(404).json({
        message: "No user found"
      });
    }
    return getUserById(req.user.user_id, req, res);
  } catch (error) {
    console.error("Problem in /user/");
    console.trace(error);
  }
});

/**
 * @api {post} /user Update a user's own profile
 * @apiGroup users
 * @apiVersion 0.1.0
 * @apiName getUserById
 * @apiParam {Number} userId user ID
 *
 * @apiSuccess {Boolean} OK true if call was successful
 * @apiSuccess {data} User object if call was successful
 * @apiSuccess {String[]} errors List of error strings (when `OK` is false)
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        OK: true
 *     }
 *
 * @apiError NotAuthenticated The user is not authenticated
 * @apiError NotAuthorized The user doesn't have permission to perform this operation.
 *
 */
router.post("/", async function(req, res) {
  try {
    let user = req.body;
    let pictureUrl = user.picture_url || user.picture;
    if (user.user_metadata && user.user_metadata.customPic) {
      pictureUrl = user.user_metadata.customPic;
    }
    await db.none(UPDATE_USER, {
      id: user.id,
      name: user.name,
      language: req.params.language || "en",
      picture_url: pictureUrl,
      bio: user.bio || ""
    });
    res.status(200).json({ OK: true });
  } catch (error) {
    log.error("Exception in POST /user => %s", error);
    if (error.message && error.message == "No data returned from the query.") {
      res.status(404).json({ OK: false });
    } else {
      res.status(500).json({ OK: false, error: error });
      console.trace(error);
    }
  }
});

/**
 * @api {delete} /user/:userId Delete a user
 * @apiGroup users
 * @apiVersion 0.1.0
 * @apiName deleteuser
 * @apiParam {Number} userId user ID
 *
 * @apiSuccess {Boolean} OK true if call was successful
 * @apiSuccess {String[]} errors List of error strings (when `OK` is false)
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        OK: true
 *     }
 *
 * @apiError NotAuthenticated The user is not authenticated
 * @apiError NotAuthorized The user doesn't have permission to perform this operation.
 *
 */

router.delete("/:userId", function edituserById(req, res) {
  cache.clear();
  // let userId = req.swagger.params.userId.value;
  // let userBody = req.body;
  res.status(200).json(req.body);
});

module.exports = router;
