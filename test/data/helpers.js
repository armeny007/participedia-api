const fs = require("fs");
const { mockRequest, mockResponse } = require("mock-req-res");
const { postCaseNewHttp } = require("../../api/controllers/case");

let example_case = JSON.parse(fs.readFileSync("test/data/case.json"));
let example_method = JSON.parse(fs.readFileSync("test/data/method.json"));
let example_organization = JSON.parse(
  fs.readFileSync("test/data/organization.json")
);
let mock_user = JSON.parse(fs.readFileSync("test/data/user.json"));
let mock_user2 = JSON.parse(fs.readFileSync("test/data/user2.json"));

async function addBasicCase() {
  const { req, res, ret } = getMocks({
    user: mock_user,
    body: example_case,
    params: {}
  });
  await postCaseNewHttp(req, res);
  return ret.body;
}

async function addBasicMethod() {
  const { req, res, ret } = getMocks({
    user: mock_user,
    body: example_method,
    params: {}
  });
  await postMethodNewHttp(req, res);
  return ret.body;
}
async function addBasicOrganization() {
  const { req, res, ret } = getMocks({
    user: mock_user,
    body: example_organization,
    params: {}
  });
  await postOrganizationNewHttp(req, res);
  return ret.body;
}
function getMocks(args) {
  const req = mockRequest(
    Object.assign({ query: { returns: "json" } }, args || {})
  );
  const ret = {};
  const res = mockResponse({
    json: body => {
      // console.log("json() called");
      ret.body = body;
    }
  });
  return { req, res, ret };
}

function getMocksAuth(args) {
  return getMocks(Object.assign({ user: mock_user2 }, args || {}));
}

module.exports = {
  getMocks,
  getMocksAuth,
  example_case,
  addBasicCase,
  addBasicMethod,
  addBasicOrganization
};
