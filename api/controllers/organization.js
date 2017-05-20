"use strict";

const express = require("express");
const router = express.Router(); // eslint-disable-line new-cap
const log = require("winston");
const jwt = require("express-jwt");

const { db, sql, as, helpers } = require("../helpers/db");
const {
  getEditXById,
  addRelatedList,
  getByType_id
} = require("../helpers/things");

const returnOrganizationById = getByType_id["organization"].returnById;
const getOrganizationById_lang_userId = getByType_id[
  "organization"
].getById_lang_userId;

const empty_organization = {
  title: "",
  body: "",
  language: "en",
  user_id: null,
  original_language: "en",
  executive_director: null,
  post_date: "now",
  published: true,
  sector: null,
  updated_date: "now",
  location: null,
  lead_image_url: "",
  other_images: "{}",
  files: "{}",
  videos: "{}",
  tags: "{}",
  featured: false
};

/**
 * @api {post} /organization/new Create new organization
 * @apiGroup Organizations
 * @apiVersion 0.1.0
 * @apiName newOrganization
 *
 * @apiSuccess {Boolean} OK true if call was successful
 * @apiSuccess {String[]} errors List of error strings (when `OK` is false)
 * @apiSuccess {Object} organization data
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "OK": true,
 *       "data": {
 *         "ID": 3,
 *         "Description": 'foo'
 *        }
 *     }
 *
 * @apiError NotAuthenticated The user is not authenticated
 * @apiError NotAuthorized The user doesn't have permission to perform this operation.
 *
 */
router.post("/new", async function(req, res) {
  // create new `organization` in db
  // req.body *should* contain:
  //   title
  //   body (or "summary"?)
  //   photo
  //   video
  //   location
  //   related organizations
  try {
    let title = req.body.title;
    let body = req.body.body || req.body.summary;
    let language = req.params.language || "en";
    if (!(title && body)) {
      return res.status(400).json({
        message: "Cannot create Organization, both title and body are required"
      });
    }
    const user_id = req.user.user_id;
    const location = as.location(req.body.location);
    const videos = as.videos(req.body.vidURL);
    const lead_image = as.attachment(req.body.lead_image); // frontend isn't sending this yet
    const organization_id = await db.one(
      sql("../sql/create_organization.sql"),
      Object.assign({}, empty_organization, {
        title,
        body,
        location,
        lead_image,
        videos,
        user_id
      })
    );
    // save related objects (needs case_id)
    const relCases = addRelatedList(
      "organization",
      organization_id.organization_id,
      "case",
      req.body.related_cases
    );
    if (relCases) {
      await db.none(relCases);
    }
    const relMethods = addRelatedList(
      "organization",
      organization_id.organization_id,
      "method",
      req.body.related_methods
    );
    if (relMethods) {
      await db.none(relMethods);
    }
    const relOrgs = addRelatedList(
      "organization",
      organization_id.organization_id,
      "organization",
      req.body.related_organizations
    );
    if (relOrgs) {
      await db.none(relOrgs);
    }
    const newOrganization = await getOrganizationById_lang_userId(
      organization_id.organization_id,
      language,
      user_id
    );
    // Refresh search index
    await db.none("REFRESH MATERIALIZED VIEW search_index_en;");
    return res.status(201).json({
      OK: true,
      data: organization_id,
      object: newOrganization
    });
  } catch (error) {
    log.error("Exception in POST /organization/new => %s", error);
    return res.status(500).json({
      OK: false,
      error: error
    });
  }
});

/**
 * @api {put} /organization/:id  Submit a new version of a organization
 * @apiGroup Organizations
 * @apiVersion 0.1.0
 * @apiName editOrganization
 * @apiParam {Number} id Organization ID
 *
 * @apiSuccess {Boolean} OK true if call was successful
 * @apiSuccess {String[]} errors List of error strings (when `OK` is false)
 * @apiSuccess {Object} organization data
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "OK": true,
 *       "data": {
 *         "ID": 3,
 *         "Description": 'foo'
 *        }
 *     }
 *
 * @apiError NotAuthenticated The user is not authenticated
 * @apiError NotAuthorized The user doesn't have permission to perform this operation.
 *
 */

router.put("/:organizationId", getEditXById("organization"));

/**
 * @api {get} /organization/:id Get the last version of an organization
 * @apiGroup Organizations
 * @apiVersion 0.1.0
 * @apiName getOrgById
 * @apiParam {Number} id Organization ID
 *
 * @apiSuccess {Boolean} OK true if call was successful
 * @apiSuccess {String[]} errors List of error strings (when `OK` is false)
 * @apiSuccess {Object} Organization data
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "OK": true,
 *       "data": {
 *         "ID": 3,
 *         "Description": 'foo'
 *        }
 *     }
 *
 * @apiError NotAuthenticated The user is not authenticated
 * @apiError NotAuthorized The user doesn't have permission to perform this operation.
 *
 */

router.get(
  "/:organizationId",
  jwt({
    secret: process.env.AUTH0_CLIENT_SECRET,
    credentialsRequired: false,
    algorithms: ["HS256"]
  }),
  returnOrganizationById
);

/**
 * @api {delete} /organization/:id Delete an organization
 * @apiGroup Organizations
 * @apiVersion 0.1.0
 * @apiName deleteOrganization
 * @apiParam {Number} Organization ID
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

router.delete("/:id", function deleteOrganization(req, res) {
  // let orgId = req.swagger.params.id.value;
  res.status(200).json(req.body);
});

module.exports = router;
