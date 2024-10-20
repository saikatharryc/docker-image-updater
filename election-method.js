
const sha256 = require('js-sha256');

const getOutDatedNodes = (nodes, threshold) => {
    //Some logics or api calls to get the outdated node count
}
const isNodeElected = (nodeId, electionThreshold, totalOutDatedNodes) =>{
    let nodeHash = sha256(nodeId);
    let nodeNumeric = parseInt(nodeHash, 16); 
    return (nodeNumeric % totalOutDatedNodes) < electionThreshold;
}
